# Scalar Commons Agent Swarm

This repo is maintained by a Claude agent swarm via claude-code-action.

## How it works
- Issues labeled agent-task trigger a Claude Sonnet agent automatically
- The agent opens a PR on a claude/issue-N branch
- CI runs cargo check; on green the PR auto-merges via auto-merge-claude.yml
