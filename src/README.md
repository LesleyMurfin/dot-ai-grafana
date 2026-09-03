# DevOps AI Toolkit (dot-ai)

AI-powered Kubernetes cluster intelligence inside Grafana — query and analysis-only remediate via the [DevOps AI Toolkit](https://devopstoolkit.ai) REST API.

## Requirements

- Grafana >= 11.0
- A reachable dot-ai MCP server (tools REST on port 3456 by default)

## Getting started

1. Install the plugin and allow unsigned load if needed: `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=devopstoolkit-dotai-app`
2. As Admin, set **MCP Server URL** and **Auth Token**, then **Test connection**
3. Open **dot-ai** from the sidebar, choose Query or Remediate (analysis only), submit a plain-language question

Remediate never executes changes. For operate/execute, use the [Headlamp plugin](https://github.com/vfarcic/dot-ai-headlamp).
