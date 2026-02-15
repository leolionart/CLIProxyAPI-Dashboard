#!/bin/sh
# Runtime env injection for Vite SPA
# Placed in /docker-entrypoint.d/ to run during nginx startup
# Replaces build-time placeholders in JS bundle with actual env vars

JS_DIR="/usr/share/nginx/html/assets"

# Replace Supabase URL placeholder
if [ -n "$SUPABASE_URL" ]; then
  find "$JS_DIR" -name '*.js' -exec sed -i "s|__SUPABASE_URL_PLACEHOLDER__|${SUPABASE_URL}|g" {} +
  echo "[env-inject] Injected SUPABASE_URL"
else
  echo "[env-inject] WARNING: SUPABASE_URL not set, dashboard will not connect to database"
fi

# Replace Supabase publishable key placeholder
if [ -n "$SUPABASE_PUBLISHABLE_KEY" ]; then
  find "$JS_DIR" -name '*.js' -exec sed -i "s|__SUPABASE_KEY_PLACEHOLDER__|${SUPABASE_PUBLISHABLE_KEY}|g" {} +
  echo "[env-inject] Injected SUPABASE_PUBLISHABLE_KEY"
else
  echo "[env-inject] WARNING: SUPABASE_PUBLISHABLE_KEY not set, dashboard will not authenticate"
fi
