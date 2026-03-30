#!/bin/bash
# Paperclip Company → OpenClaw Agent Config Converter
# Usage: ./paperclip-to-openclaw.sh <company-dir> <output-dir>
#
# Reads Paperclip company format (COMPANY.md, agents/*/AGENTS.md, skills/*)
# Outputs OpenClaw agent configs (SOUL.md, skills/, openclaw-agent.json)

set -euo pipefail

COMPANY_DIR="${1:?Usage: $0 <company-dir> <output-dir>}"
OUTPUT_DIR="${2:?Usage: $0 <company-dir> <output-dir>}"

if [ ! -f "$COMPANY_DIR/COMPANY.md" ]; then
  echo "Error: $COMPANY_DIR/COMPANY.md not found"
  exit 1
fi

# Extract company name from COMPANY.md frontmatter
COMPANY_NAME=$(grep '^name:' "$COMPANY_DIR/COMPANY.md" | head -1 | sed 's/name: *//')
COMPANY_SLUG=$(grep '^slug:' "$COMPANY_DIR/COMPANY.md" | head -1 | sed 's/slug: *//')

echo "Converting: $COMPANY_NAME ($COMPANY_SLUG)"
echo "Output: $OUTPUT_DIR"

mkdir -p "$OUTPUT_DIR"

# Convert each agent
if [ -d "$COMPANY_DIR/agents" ]; then
  for AGENT_DIR in "$COMPANY_DIR/agents"/*/; do
    AGENT_ID=$(basename "$AGENT_DIR")
    AGENT_FILE="$AGENT_DIR/AGENTS.md"
    
    if [ ! -f "$AGENT_FILE" ]; then
      echo "  Skipping $AGENT_ID (no AGENTS.md)"
      continue
    fi

    AGENT_OUTPUT="$OUTPUT_DIR/agents/$AGENT_ID"
    mkdir -p "$AGENT_OUTPUT"

    # Extract frontmatter fields
    AGENT_NAME=$(sed -n '/^---$/,/^---$/p' "$AGENT_FILE" | grep '^name:' | head -1 | sed 's/name: *//')
    AGENT_TITLE=$(sed -n '/^---$/,/^---$/p' "$AGENT_FILE" | grep '^title:' | head -1 | sed 's/title: *//')
    AGENT_SKILLS=$(sed -n '/^---$/,/^---$/p' "$AGENT_FILE" | grep '^ *- ' | sed 's/^ *- //' | tr '\n' ',' | sed 's/,$//')

    # Extract body (after second ---)
    AGENT_BODY=$(sed -n '/^---$/,/^---$/!p' "$AGENT_FILE" | tail -n +1)

    # Generate SOUL.md (OpenClaw agent identity)
    cat > "$AGENT_OUTPUT/SOUL.md" << EOF
# $AGENT_NAME — $AGENT_TITLE

## Company: $COMPANY_NAME

$AGENT_BODY
EOF

    # Generate agent config JSON
    cat > "$AGENT_OUTPUT/agent.json" << EOF
{
  "agentId": "$AGENT_ID",
  "name": "$AGENT_NAME",
  "title": "$AGENT_TITLE",
  "company": "$COMPANY_SLUG",
  "skills": [$(echo "$AGENT_SKILLS" | sed 's/[^,]*/"&"/g')]
}
EOF

    echo "  ✓ $AGENT_NAME ($AGENT_ID)"
  done
fi

# Copy skills
if [ -d "$COMPANY_DIR/skills" ]; then
  SKILL_COUNT=0
  for SKILL_DIR in "$COMPANY_DIR/skills"/*/; do
    SKILL_ID=$(basename "$SKILL_DIR")
    SKILL_OUTPUT="$OUTPUT_DIR/skills/$SKILL_ID"
    mkdir -p "$SKILL_OUTPUT"
    cp -r "$SKILL_DIR"/* "$SKILL_OUTPUT/" 2>/dev/null || true
    SKILL_COUNT=$((SKILL_COUNT + 1))
  done
  echo "  ✓ $SKILL_COUNT skills copied"
fi

# Generate company manifest
AGENT_COUNT=$(find "$OUTPUT_DIR/agents" -name "agent.json" 2>/dev/null | wc -l)
TOTAL_SKILLS=$(find "$OUTPUT_DIR/skills" -name "SKILL.md" 2>/dev/null | wc -l)

cat > "$OUTPUT_DIR/manifest.json" << EOF
{
  "name": "$COMPANY_NAME",
  "slug": "$COMPANY_SLUG",
  "schema": "openclaw-company/v1",
  "source": "paperclip",
  "agents": $AGENT_COUNT,
  "skills": $TOTAL_SKILLS,
  "convertedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo ""
echo "Done: $AGENT_COUNT agents, $TOTAL_SKILLS skills"
echo "Manifest: $OUTPUT_DIR/manifest.json"
