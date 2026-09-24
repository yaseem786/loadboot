#!/usr/bin/env bash
# Copies the real engine + carrier CSS into lib/ so index.html works when opened locally.
# lib/ is git-ignored; the source of truth stays in app/. Re-run after editing tour.js or content.
cd "$(dirname "$0")" && rm -rf lib && mkdir lib && cp ../../app/shared/tokens.css ../../app/shared/ui/{dom,icons,components,tour}.js ../../app/shared/ui/tour.css ../../app/carrier/{carrier,carrier-dark}.css ../../app/carrier/tour-content.js lib/ && echo "lib synced"
