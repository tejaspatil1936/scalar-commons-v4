#!/usr/bin/env bash
# Render the nginx templates by substituting values from domain.env.
#
# Writes only into deploy/public/rendered/ inside the repo. It does NOT copy
# anything into /etc/nginx, does not reload nginx, and does not touch the
# firewall. A human does those steps — see INSTALL.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/domain.env"
OUT_DIR="$HERE/rendered"

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }

# shellcheck source=/dev/null
set -a; . "$ENV_FILE"; set +a

: "${DOMAIN:?DOMAIN unset in domain.env}"
: "${LANDING_DIST:?LANDING_DIST unset in domain.env}"
: "${DOCS_DIST:?DOCS_DIST unset in domain.env}"
: "${ACME_WEBROOT:?ACME_WEBROOT unset in domain.env}"

if [ "$DOMAIN" = "example.com" ]; then
    echo "refusing to render: DOMAIN is still the placeholder 'example.com'." >&2
    echo "Edit $ENV_FILE first." >&2
    exit 1
fi

mkdir -p "$OUT_DIR"

for tpl in "$HERE"/nginx/*.conf.template; do
    out="$OUT_DIR/$(basename "${tpl%.template}")"
    sed -e "s|<DOMAIN>|$DOMAIN|g" \
        -e "s|<LANDING_DIST>|$LANDING_DIST|g" \
        -e "s|<DOCS_DIST>|$DOCS_DIST|g" \
        -e "s|<ACME_WEBROOT>|$ACME_WEBROOT|g" \
        "$tpl" > "$out"
    echo "rendered $out"
done

if grep -rn '<DOMAIN>\|<LANDING_DIST>\|<DOCS_DIST>\|<ACME_WEBROOT>' "$OUT_DIR"; then
    echo "ERROR: unsubstituted placeholders remain (above)." >&2
    exit 1
fi

echo
echo "OK. Nothing has been installed. Next: INSTALL.md step 6."
