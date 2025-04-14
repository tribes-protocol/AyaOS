#!/usr/bin/env bash

# Validate command line arguments
if [ $# -ne 1 ]; then
  echo "Error: 'init' command required"
  echo "Usage: ayaos init"
  exit 1
fi

if [ "$1" != "init" ]; then
  echo "Error: Invalid argument '$1'"
  echo "Usage: ayaos init"
  exit 1
fi


# Check if Bun is installed globally
if ! command -v bun &> /dev/null; then
  echo "Bun is not installed. Please install it first:"
  echo "curl -fsSL https://bun.sh/install | bash"
  exit 1
fi


# 1. Ask user what they want to name the project
read -p "What do you want to name the project? " projectName
# 2. Where do you want the data directory to be?
while true; do
  read -p "Where do you want the data directory to be? (Please provide full path) " dataDir
  # Exit if empty
  if [[ -z "$dataDir" ]]; then
    echo "Data directory path is required. Exiting..."
    exit 1
  fi
  # Expand ~ to home directory if present
  dataDir="${dataDir/#\~/$HOME}"
  # Validate that dataDir is a full path
  if [[ "$dataDir" != /* ]]; then
    echo "Error: Please provide a full path starting with '/' or '~'"
    continue
  fi

  break
done


# 3. What is your agent's name?
read -p "What is your agent's name? " agentName
# 4. What is your agent's purpose?
read -p "What is your agent's purpose? " agentPurpose


# Clone the repository into the project directory
git clone https://github.com/tribes-protocol/agent "$projectName"
# Remove .git directory
rm -rf "$projectName/.git"
# Create .env file with data directory
echo "DATA_DIR=\"$dataDir\"" > "$projectName/.env"

# Move into project directory and install dependencies
ORIGINAL_DIR=$(pwd)
(cd "$projectName" && bun i) || {
  echo "Failed to install dependencies"
  cd "$ORIGINAL_DIR"
  exit 1
}
cd "$ORIGINAL_DIR"


# Create data directory if it doesn't exist
mkdir -p "$dataDir"

# Create a simple temporary TypeScript script that will help us find the create-agent.ts module
TEMP_SCRIPT=$(mktemp)
cat > "$TEMP_SCRIPT" << 'EOL'
try {
  const path = require('path');
  const fs = require('fs');
  
  // Try to resolve via require.resolve
  try {
    // First check for direct module
    console.log(require.resolve('@tribesxyz/ayaos/scripts/create-agent.ts'));
    process.exit(0);
  } catch (e) {
    // If that fails, look relative to current directory
    const scriptDir = path.dirname(process.argv[1]);
    const packageDir = path.resolve(scriptDir, '..');
    
    // Try common locations
    const possibleLocations = [
      path.join(packageDir, 'scripts', 'create-agent.ts'),
      path.join(packageDir, 'dist', 'scripts', 'create-agent.ts'),
      path.join(packageDir, 'node_modules', '@tribesxyz', 'ayaos', 'scripts', 'create-agent.ts')
    ];
    
    for (const loc of possibleLocations) {
      if (fs.existsSync(loc)) {
        console.log(loc);
        process.exit(0);
      }
    }
  }
  
  // If we get here, we couldn't find it
  console.error('Could not find create-agent.ts script');
  process.exit(1);
} catch (error) {
  console.error('Error finding script:', error);
  process.exit(1);
}
EOL

# Run the temp script with node to find the location of create-agent.ts
CREATE_AGENT_SCRIPT=$(node "$TEMP_SCRIPT" 2>/dev/null)
EXIT_CODE=$?
rm "$TEMP_SCRIPT"

# If the script wasn't found, try manual paths as a fallback
if [ $EXIT_CODE -ne 0 ]; then
  # Get the directory where this script is located
  SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
  PACKAGE_ROOT="$(dirname "$SCRIPT_DIR")"
  
  # Try some common locations
  CREATE_AGENT_SCRIPT=""
  for path in \
    "$PACKAGE_ROOT/scripts/create-agent.ts" \
    "$PACKAGE_ROOT/dist/scripts/create-agent.ts" \
    "$(bun pm bin)/../@tribesxyz/ayaos/scripts/create-agent.ts" \
    "$(npm root -g)/@tribesxyz/ayaos/scripts/create-agent.ts" \
    "$(npm root)/@tribesxyz/ayaos/scripts/create-agent.ts"; do
    if [ -f "$path" ]; then
      CREATE_AGENT_SCRIPT="$path"
      break
    fi
  done
fi

# Check if we found the script
if [ -z "$CREATE_AGENT_SCRIPT" ] || [ ! -f "$CREATE_AGENT_SCRIPT" ]; then
  echo "Error: Cannot find the create-agent.ts script"
  echo "Please ensure the scripts directory is included in the published package"
  exit 1
fi

# Run create-agent script with bun
ORIGINAL_DIR=$(pwd)
(cd "$projectName" && bun run "$CREATE_AGENT_SCRIPT" "$dataDir" "$agentName" "$agentPurpose") || {
  echo "Failed to create agent"
  cd "$ORIGINAL_DIR"
  exit 1
}
cd "$ORIGINAL_DIR"

# Display success message with a nice box
echo
echo "┌──────────────────────────────────────────────────────────────────────┐"
echo "│                                                                      │"
echo "│  ✓ Repository cloned successfully!                                   │"
echo "│                                                                      │"
echo "│  Next steps:                                                         │"
echo "│                                                                      │"
echo "│  1. cd $projectName                                                  │"
echo "│                                                                      │"
echo "│  2. Add your OpenAI API key to .env:                                 │"
echo "│     OPENAI_API_KEY=your_api_key_here                                 │"
echo "│                                                                      │"
echo "│  3. Run the development server with: bun dev                         │"
echo "│                                                                      │"
echo "└──────────────────────────────────────────────────────────────────────┘"
echo

