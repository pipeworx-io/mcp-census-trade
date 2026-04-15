interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Census Trade MCP — US Census Bureau International Trade data
 *
 * Tools:
 * - census_imports: US imports by HS code and country
 * - census_exports: US exports by HS code and country
 * - census_trade_balance: US trade balance with a country
 * - census_trade_trends: monthly trade trends over time
 */


const BASE_URL = 'https://api.census.gov/data/timeseries/intltrade';

const tools: McpToolExport['tools'] = [
  {
    name: 'census_imports',
    description:
      'Get US import data by HS commodity code and/or country. Returns import values, quantities, commodity details, and country names from the US Census Bureau.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hs_code: {
          type: 'string',
          description: 'HS commodity code at 2, 4, or 6 digit level (e.g., "8471" for computers, "87" for vehicles)',
        },
        country_code: {
          type: 'string',
          description: 'Census country code (e.g., "5700" for China, "2010" for Mexico). Optional — omit for all countries.',
        },
        year: {
          type: 'string',
          description: 'Trade year (e.g., "2024")',
        },
        month: {
          type: 'string',
          description: 'Trade month 01-12 (e.g., "06" for June). Optional — omit for annual data.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records to return (default 20)',
        },
      },
      required: ['hs_code', 'year'],
    },
  },
  {
    name: 'census_exports',
    description:
      'Get US export data by HS commodity code and/or country. Returns export values, quantities, commodity details, and country names from the US Census Bureau.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hs_code: {
          type: 'string',
          description: 'HS commodity code at 2, 4, or 6 digit level (e.g., "8471" for computers)',
        },
        country_code: {
          type: 'string',
          description: 'Census country code (e.g., "5700" for China). Optional — omit for all countries.',
        },
        year: {
          type: 'string',
          description: 'Trade year (e.g., "2024")',
        },
        month: {
          type: 'string',
          description: 'Trade month 01-12. Optional — omit for annual data.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records to return (default 20)',
        },
      },
      required: ['hs_code', 'year'],
    },
  },
  {
    name: 'census_trade_balance',
    description:
      'Get the US trade balance (exports minus imports) with a specific country for a given year. Uses end-use commodity categories for aggregate values.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        country_code: {
          type: 'string',
          description: 'Census country code (e.g., "5700" for China, "2010" for Mexico)',
        },
        year: {
          type: 'string',
          description: 'Trade year (e.g., "2024")',
        },
      },
      required: ['country_code', 'year'],
    },
  },
  {
    name: 'census_trade_trends',
    description:
      'Get monthly US trade trends over a period. Shows how trade values change month by month for a commodity and/or country.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hs_code: {
          type: 'string',
          description: 'HS commodity code. Optional — omit for aggregate trade.',
        },
        country_code: {
          type: 'string',
          description: 'Census country code. Optional — omit for all countries.',
        },
        start_year: {
          type: 'string',
          description: 'Start year (e.g., "2022")',
        },
        end_year: {
          type: 'string',
          description: 'End year (e.g., "2024")',
        },
      },
      required: ['start_year', 'end_year'],
    },
  },
];

type CensusRow = string[];
type CensusResponse = CensusRow[];

async function fetchCensus(endpoint: string, params: Record<string, string>): Promise<CensusResponse> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Census API error: ${res.status} ${res.statusText} — ${text}`);
  }

  const data = (await res.json()) as CensusResponse;
  if (!Array.isArray(data) || data.length < 2) {
    throw new Error('Census API returned no data for this query');
  }
  return data;
}

function parseRows(data: CensusResponse, limit: number = 20) {
  const headers = data[0];
  const rows = data.slice(1, limit + 1);
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

async function getImports(
  hsCode: string,
  year: string,
  countryCode?: string,
  month?: string,
  limit: number = 20,
) {
  const commLvl = hsCode.length <= 2 ? 'HS2' : hsCode.length <= 4 ? 'HS4' : 'HS6';
  const params: Record<string, string> = {
    get: 'GEN_VAL_MO,GEN_QY1_MO,I_COMMODITY,CTY_CODE,CTY_NAME',
    COMM_LVL: commLvl,
    I_COMMODITY: hsCode,
    time: month ? `${year}-${month}` : year,
  };
  if (countryCode) {
    params.CTY_CODE = countryCode;
  }

  const data = await fetchCensus('imports/hs', params);
  const records = parseRows(data, limit);

  return {
    type: 'US Imports',
    hs_code: hsCode,
    period: month ? `${year}-${month}` : year,
    count: records.length,
    records: records.map((r) => ({
      commodity_code: r.I_COMMODITY,
      country_code: r.CTY_CODE,
      country_name: r.CTY_NAME,
      import_value_usd: Number(r.GEN_VAL_MO) || 0,
      quantity: Number(r.GEN_QY1_MO) || 0,
      period: r.time,
    })),
  };
}

async function getExports(
  hsCode: string,
  year: string,
  countryCode?: string,
  month?: string,
  limit: number = 20,
) {
  const commLvl = hsCode.length <= 2 ? 'HS2' : hsCode.length <= 4 ? 'HS4' : 'HS6';
  const params: Record<string, string> = {
    get: 'ALL_VAL_MO,QTY_1_MO,E_COMMODITY,CTY_CODE,CTY_NAME',
    COMM_LVL: commLvl,
    E_COMMODITY: hsCode,
    time: month ? `${year}-${month}` : year,
  };
  if (countryCode) {
    params.CTY_CODE = countryCode;
  }

  const data = await fetchCensus('exports/hs', params);
  const records = parseRows(data, limit);

  return {
    type: 'US Exports',
    hs_code: hsCode,
    period: month ? `${year}-${month}` : year,
    count: records.length,
    records: records.map((r) => ({
      commodity_code: r.E_COMMODITY,
      country_code: r.CTY_CODE,
      country_name: r.CTY_NAME,
      export_value_usd: Number(r.ALL_VAL_MO) || 0,
      quantity: Number(r.QTY_1_MO) || 0,
      period: r.time,
    })),
  };
}

async function getTradeBalance(countryCode: string, year: string) {
  const [importsData, exportsData] = await Promise.all([
    fetchCensus('imports/enduse', {
      get: 'GEN_VAL_YR,CTY_CODE,CTY_NAME',
      CTY_CODE: countryCode,
      time: year,
    }),
    fetchCensus('exports/enduse', {
      get: 'ALL_VAL_YR,CTY_CODE,CTY_NAME',
      CTY_CODE: countryCode,
      time: year,
    }),
  ]);

  const importRows = parseRows(importsData);
  const exportRows = parseRows(exportsData);

  const totalImports = importRows.reduce((sum, r) => sum + (Number(r.GEN_VAL_YR) || 0), 0);
  const totalExports = exportRows.reduce((sum, r) => sum + (Number(r.ALL_VAL_YR) || 0), 0);
  const balance = totalExports - totalImports;

  const countryName = importRows[0]?.CTY_NAME || exportRows[0]?.CTY_NAME || countryCode;

  return {
    country: countryName,
    country_code: countryCode,
    year,
    total_imports_usd: totalImports,
    total_exports_usd: totalExports,
    trade_balance_usd: balance,
    deficit_or_surplus: balance >= 0 ? 'surplus' : 'deficit',
  };
}

async function getTradeTrends(
  startYear: string,
  endYear: string,
  hsCode?: string,
  countryCode?: string,
) {
  const startYr = parseInt(startYear, 10);
  const endYr = parseInt(endYear, 10);
  if (endYr - startYr > 5) {
    throw new Error('Date range too large. Maximum 5 year span supported.');
  }

  const timeRange = `from ${startYear} to ${endYear}`;

  const importParams: Record<string, string> = {
    get: 'GEN_VAL_MO,CTY_CODE,CTY_NAME,time',
    time: timeRange,
  };
  const exportParams: Record<string, string> = {
    get: 'ALL_VAL_MO,CTY_CODE,CTY_NAME,time',
    time: timeRange,
  };

  if (hsCode) {
    const commLvl = hsCode.length <= 2 ? 'HS2' : hsCode.length <= 4 ? 'HS4' : 'HS6';
    importParams.COMM_LVL = commLvl;
    importParams.I_COMMODITY = hsCode;
    exportParams.COMM_LVL = commLvl;
    exportParams.E_COMMODITY = hsCode;
  }
  if (countryCode) {
    importParams.CTY_CODE = countryCode;
    exportParams.CTY_CODE = countryCode;
  }

  const [importsData, exportsData] = await Promise.all([
    fetchCensus('imports/hs', importParams).catch(() => null),
    fetchCensus('exports/hs', exportParams).catch(() => null),
  ]);

  const importRecords = importsData ? parseRows(importsData, 200) : [];
  const exportRecords = exportsData ? parseRows(exportsData, 200) : [];

  const monthlyData: Record<string, { imports: number; exports: number }> = {};

  for (const r of importRecords) {
    const period = r.time;
    if (!monthlyData[period]) monthlyData[period] = { imports: 0, exports: 0 };
    monthlyData[period].imports += Number(r.GEN_VAL_MO) || 0;
  }

  for (const r of exportRecords) {
    const period = r.time;
    if (!monthlyData[period]) monthlyData[period] = { imports: 0, exports: 0 };
    monthlyData[period].exports += Number(r.ALL_VAL_MO) || 0;
  }

  const trends = Object.entries(monthlyData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, values]) => ({
      period,
      imports_usd: values.imports,
      exports_usd: values.exports,
      balance_usd: values.exports - values.imports,
    }));

  return {
    start_year: startYear,
    end_year: endYear,
    hs_code: hsCode || 'all',
    country_code: countryCode || 'all',
    months: trends.length,
    trends,
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'census_imports':
      return getImports(
        args.hs_code as string,
        args.year as string,
        args.country_code as string | undefined,
        args.month as string | undefined,
        (args.limit as number) || 20,
      );
    case 'census_exports':
      return getExports(
        args.hs_code as string,
        args.year as string,
        args.country_code as string | undefined,
        args.month as string | undefined,
        (args.limit as number) || 20,
      );
    case 'census_trade_balance':
      return getTradeBalance(args.country_code as string, args.year as string);
    case 'census_trade_trends':
      return getTradeTrends(
        args.start_year as string,
        args.end_year as string,
        args.hs_code as string | undefined,
        args.country_code as string | undefined,
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 5 } } satisfies McpToolExport;
