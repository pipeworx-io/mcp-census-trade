# mcp-census-trade

Census Trade MCP — US Census Bureau International Trade data

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `census_imports` | Search US import data by HS commodity code and/or country. Returns import values, quantities, and commodity details. Pass `country` as a plain English name (e.g. "China"). Omit hs_code for total imports from a country; omit country for all countries combined. |
| `census_exports` | Search US export data by HS commodity code and/or country. Returns export values, quantities, and commodity details. Pass `country` as a plain English name (e.g. "Mexico"). Omit hs_code for total exports to a country; omit country for all countries combined. |
| `census_trade_balance` | Check US trade balance with a specific country for a given year. Returns net trade value and breakdown by end-use commodity category. |
| `census_trade_trends` | Get monthly US trade trends for a commodity and/or country over time. Returns month-by-month values to identify seasonal patterns and shifts. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "census-trade": {
      "url": "https://gateway.pipeworx.io/census-trade/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Census Trade data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
