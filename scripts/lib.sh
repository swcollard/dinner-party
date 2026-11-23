# Shared helpers for scripts/seed.sh and scripts/smoke.sh (sourced, not run).

# Check the command-line tools the scripts need, naming whatever is missing.
require_tools() {
  local missing=() t
  for t in "$@"; do command -v "$t" >/dev/null 2>&1 || missing+=("$t"); done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "Missing: ${missing[*]}. Install it first (macOS: brew install ${missing[*]})." >&2
    exit 2
  fi
}

# The setup secret: $SETUP_SECRET if set, else SETUP_SECRET from .dev.vars, read the way
# wrangler reads it (surrounding whitespace, quotes and Windows line endings don't count).
read_setup_secret() {
  local root=$1 v=${SETUP_SECRET:-}
  if [ -z "$v" ] && [ -f "$root/.dev.vars" ]; then
    v=$(tr -d '\r' < "$root/.dev.vars" | sed -n 's/^[[:space:]]*SETUP_SECRET[[:space:]]*=[[:space:]]*//p' | tail -n 1)
    case $v in
      \"*\"*) v=${v#\"}; v=${v%%\"*} ;;
      \'*\'*) v=${v#\'}; v=${v%%\'*} ;;
      *) v=$(printf '%s' "$v" | sed -e 's/[[:space:]]#.*$//' -e 's/[[:space:]]*$//') ;;
    esac
  fi
  if [ -z "$v" ]; then
    echo "No SETUP_SECRET found. Run: cp .dev.vars.example .dev.vars   (then restart npm run dev)" >&2
    exit 2
  fi
  printf '%s' "$v"
}

# Exit with a clear message unless the dev server answers at $1.
require_server() {
  curl -s -o /dev/null "$1/healthz" || {
    echo "Nothing is answering at $1. Start the app first with: npm run dev" >&2
    exit 2
  }
}
