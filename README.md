# Test Track

A static frontend for visualizing GTFS realtime feeds

## Overview

<!-- Describe the service's role in the overall gtfs.zone system here -->

## Running Locally


<!-- Add project-specific run instructions here -->


## Development


<!-- Add project-specific development instructions here -->

## MCP Setup

Claude Code uses the Forgejo MCP server to interact with issues and PRs.

1. Fill in `.envrc` with your token (Forgejo → Settings → Applications → Generate token):
   ```bash
   export FORGEJO_ACCESS_TOKEN=<your-token>
   ```
2. Run `direnv allow` to activate
3. Restart Claude Code — the `forgejo` MCP server will be available

