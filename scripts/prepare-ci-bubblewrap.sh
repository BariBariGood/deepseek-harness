#!/usr/bin/env bash
set -euo pipefail

# Ubuntu's package transaction scans the hosted image's full dpkg database and
# runs post-install hooks. CI needs only the signed-archive payload, so resolve
# it from the release's own index and verify each hop before extracting it into
# the ephemeral runner directory.
#
# The version and digest are NOT pinned: archive.ubuntu.com keeps only the
# newest point release of a pocket in pool/, so a pinned URL 404s the day the
# archive publishes a successor — nightly e2e broke for weeks when
# 0.9.0-1ubuntu0.1 rotated out under -ubuntu0.3. Instead the script walks the
# same trust chain apt does: InRelease (verified against the archive keyring
# the runner image ships) carries the Packages index digest, and the index
# carries the deb digest. Every artifact is checked against a signed parent,
# so the integrity guarantee matches the old hardcoded pin without the rot.
readonly ARCHIVE='https://archive.ubuntu.com/ubuntu'
readonly KEYRING='/usr/share/keyrings/ubuntu-archive-keyring.gpg'
readonly COMPONENT_PATH='main/binary-amd64/Packages.xz'
readonly PACKAGE='bubblewrap'

: "${RUNNER_TEMP:?prepare-ci-bubblewrap requires RUNNER_TEMP}"
: "${GITHUB_PATH:?prepare-ci-bubblewrap requires GITHUB_PATH}"

if [[ "$(uname -s)" != 'Linux' || "$(uname -m)" != 'x86_64' ]]; then
  echo 'prepare-ci-bubblewrap supports only Linux x86_64 hosted runners' >&2
  exit 1
fi
source /etc/os-release
: "${VERSION_CODENAME:?/etc/os-release carries no VERSION_CODENAME}"
[[ -r "$KEYRING" ]] || { echo "archive keyring missing at $KEYRING — cannot verify the index chain" >&2; exit 1; }

fetch() { curl --fail --silent --show-error --location --retry 3 --retry-all-errors --output "$1" "$2"; }

# One pocket's resolution: read its InRelease, verify the signature, pull the
# Packages index digest out of it, fetch and verify that index, then read the
# package stanza. Prints '<filename> <sha256>' on success, nothing on a pocket
# that does not carry the package.
resolve() {
  local pocket="$1" dir="$2"
  fetch "$dir/InRelease" "$ARCHIVE/dists/$pocket/InRelease"
  gpgv --keyring "$KEYRING" "$dir/InRelease" >/dev/null 2>&1
  local index_sha
  index_sha=$(awk -v p="$COMPONENT_PATH" '$3 == p && $1 ~ /^[0-9a-f]{64}$/ { print $1; exit }' "$dir/InRelease")
  [[ -n "$index_sha" ]] || { echo "$pocket: no $COMPONENT_PATH entry in InRelease" >&2; return 1; }
  fetch "$dir/Packages.xz" "$ARCHIVE/dists/$pocket/$COMPONENT_PATH"
  printf '%s  %s\n' "$index_sha" "$dir/Packages.xz" | sha256sum --check --status
  xz -dc "$dir/Packages.xz" | awk -v pkg="$PACKAGE" '
    BEGIN { RS = ""; FS = "\n" }
    $0 ~ "(^|\n)Package: " pkg "(\n|$)" && $0 ~ "(^|\n)Architecture: amd64(\n|$)" {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^Filename: /) { f = substr($i, 11) }
        if ($i ~ /^SHA256: /)   { s = substr($i, 8) }
      }
    }
    END { if (f != "" && s != "") print f " " s; else exit 1 }'
}

work="${RUNNER_TEMP}/dsh-bubblewrap"
mkdir -p "$work"
resolved=''
for pocket in "${VERSION_CODENAME}-updates" "$VERSION_CODENAME"; do
  resolved=$(resolve "$pocket" "$work" 2>/dev/null) && break
done
[[ -n "$resolved" ]] || { echo "no signed bubblewrap stanza in ${VERSION_CODENAME}(-updates)" >&2; exit 1; }
read -r filename sha256 <<<"$resolved"

archive="${RUNNER_TEMP}/$(basename "$filename")"
fetch "$archive" "$ARCHIVE/$filename"
printf '%s  %s\n' "$sha256" "$archive" | sha256sum --check --status
dpkg-deb --extract "$archive" "$work"
printf '%s\n' "$work/usr/bin" >> "$GITHUB_PATH"

sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 \
  || echo 'apparmor userns knob absent — the functional probe decides'
"$work/usr/bin/bwrap" --version
"$work/usr/bin/bwrap" --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true
echo 'bubblewrap functional probe passed'
