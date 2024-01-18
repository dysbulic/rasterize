#!/bin/bash

PERDAY=195

[ -z "$*" ] && cat <<EOF && exit 1
Description: Spiders a Vecteezy URL at $PERDAY images per day.

Usage: $0 [options] <url>

Wraps:
$(./spider.js --help | sed 's/^/  /')
EOF

./spider.js -d $(((24 * 60 * 60) / 195)) "$@"

