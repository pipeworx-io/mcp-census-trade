interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
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
      'Search US import data by HS commodity code and/or country. Returns import values, quantities, and commodity details. Pass `country` as a plain English name (e.g. "China"). Omit hs_code for total imports from a country; omit country for all countries combined.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hs_code: {
          type: 'string',
          description: 'HS commodity code at 2, 4, or 6 digit level (e.g., "8471" for computers, "87" for vehicles). Optional — omit for total imports across all commodities.',
        },
        country: {
          type: 'string',
          description: 'Country name in plain English (e.g., "Mexico", "South Korea", "European Union"). Preferred over country_code — this is resolved for you. Optional — omit for all countries combined.',
        },
        country_code: {
          type: 'string',
          description: 'Census Schedule C country code if you already have one (e.g., "5700" China, "2010" Mexico). NOT an ISO code — "MX" and "CN" will not work. Prefer `country` and pass a name instead. Optional.',
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
      required: ['year'],
    },
  },
  {
    name: 'census_exports',
    description:
      'Search US export data by HS commodity code and/or country. Returns export values, quantities, and commodity details. Pass `country` as a plain English name (e.g. "Mexico"). Omit hs_code for total exports to a country; omit country for all countries combined.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hs_code: {
          type: 'string',
          description: 'HS commodity code at 2, 4, or 6 digit level (e.g., "8471" for computers). Optional — omit for total exports across all commodities.',
        },
        country: {
          type: 'string',
          description: 'Country name in plain English (e.g., "Mexico", "South Korea", "European Union"). Preferred over country_code — this is resolved for you. Optional — omit for all countries combined.',
        },
        country_code: {
          type: 'string',
          description: 'Census Schedule C country code if you already have one (e.g., "5700" China, "2010" Mexico). NOT an ISO code — "MX" and "CN" will not work. Prefer `country` and pass a name instead. Optional.',
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
      required: ['year'],
    },
  },
  {
    name: 'census_trade_balance',
    description:
      'Check US trade balance with a specific country for a given year. Returns net trade value and breakdown by end-use commodity category.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        country: {
          type: 'string',
          description: 'Country name in plain English (e.g., "Mexico", "China"). Preferred — resolved for you. Pass this OR country_code.',
        },
        country_code: {
          type: 'string',
          description: 'Census Schedule C country code (e.g., "5700" China, "2010" Mexico). NOT an ISO code. Prefer `country`.',
        },
        year: {
          type: 'string',
          description: 'Trade year (e.g., "2024")',
        },
      },
      // country_code is no longer structurally required: `country` satisfies it
      // too, and the handler rejects the both-missing case with a clear message.
      required: ['year'],
    },
  },
  {
    name: 'census_trade_trends',
    description:
      'Monthly US trade trends with ONE trading partner — month-by-month imports and exports for a country, optionally narrowed to an HS commodity, to show seasonality and shifts. A country is required: an unfiltered monthly query spans every partner and the Census API cannot return it in time. For all-countries totals use census_imports / census_exports instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hs_code: {
          type: 'string',
          description: 'HS commodity code. Optional — omit for aggregate trade.',
        },
        country: {
          type: 'string',
          description: 'Country name in plain English (e.g., "Mexico"). Preferred — resolved for you. REQUIRED unless you pass country_code.',
        },
        country_code: {
          type: 'string',
          description: 'Census Schedule C country code (e.g. "5700" China, "2010" Mexico). NOT an ISO code. Prefer `country`. Satisfies the country requirement.',
        },
        start_year: {
          type: 'string',
          description: 'Start year (e.g., "2022"). Optional — defaults to the same year as end_year, i.e. a single year. Maximum span 3 years.',
        },
        end_year: {
          type: 'string',
          description: 'End year (e.g., "2024"). Optional — defaults to the last fully-published year (last calendar year; Census publishes on a lag).',
        },
      },
      // Neither year is structurally required: the gateway validates declared
      // `required` args BEFORE calling the pack, so a caller who omits both (the
      // common case for "recent trend" questions) never reached getTradeTrends()
      // at all — same class as the census_exports/imports hs_code fix in
      // 9b975b48. getTradeTrends() defaults both.
      //
      // `country` is required in PRACTICE but not declared here, for the same
      // reason census_trade_balance leaves it out: either `country` or
      // `country_code` satisfies it, which `required` cannot express. The
      // handler rejects the both-missing case with a message naming both.
      required: [],
    },
  },
];

// Census foreign trade uses its OWN country codes (Schedule C): Mexico is
// "2010", China is "5700". They are not ISO codes, and not the UN M49 codes the
// comtrade pack uses, so a caller has no way to derive one and no reason to
// guess that one is wanted.
//
// So callers pass `country: "Mexico"`. The pack only ever read `country_code`,
// which meant the name landed on an argument that did not exist, the CTY_CODE
// filter was never applied, and Census happily answered with EVERY country —
// truncated to the first 20 rows. "US vehicle exports to Mexico" came back as
// the United Arab Emirates and Yemen, and nothing in the response said the
// country filter had been dropped. Asking for Japan returned byte-identical
// output. That is the worst failure this pack can have: not an error, but a
// confident wrong answer that a caller has no way to detect.
//
// Hence three rules below: `country` is accepted and resolved; a name we cannot
// resolve is a hard user_error rather than a silent worldwide query; and every
// response states which country it actually filtered on.
//
// Codes verified against the live API (exports/hs, HS2, 2025-01), not recalled
// from memory — a wrong code here would turn a silently-wrong answer into a
// confidently-wrong one, which is worse. Note 4099/4279 break the round-hundred
// pattern of their neighbours, and Hong Kong/Taiwan are separate from China.
const COUNTRY_CODES: Record<string, string> = {
  mexico: '2010', canada: '1220', china: '5700', japan: '5880', germany: '4280',
  'united kingdom': '4120', uk: '4120', britain: '4120', 'great britain': '4120', england: '4120',
  'south korea': '5800', korea: '5800', 'korea south': '5800', 'republic of korea': '5800',
  india: '5330', taiwan: '5830', vietnam: '5520', 'viet nam': '5520',
  netherlands: '4210', holland: '4210', france: '4279', italy: '4759', brazil: '3510',
  singapore: '5590', switzerland: '4419', ireland: '4190', belgium: '4231',
  australia: '6021', thailand: '5490', malaysia: '5570', spain: '4700', israel: '5081',
  colombia: '3010', chile: '3370', 'saudi arabia': '5170',
  'united arab emirates': '5200', uae: '5200', emirates: '5200',
  indonesia: '5600', philippines: '5650', 'the philippines': '5650',
  poland: '4550', sweden: '4010', turkey: '4890', turkiye: '4890',
  argentina: '3570', 'south africa': '7910', 'new zealand': '6141',
  norway: '4039', denmark: '4099', austria: '4330',
  russia: '4621', 'russian federation': '4621',
  egypt: '7290', nigeria: '7530', peru: '3330', 'hong kong': '5820',
  honduras: '2150', 'dominican republic': '2470', 'costa rica': '2230',
  // Trade blocs and continental aggregates Census exposes as pseudo-countries.
  'european union': '0003', eu: '0003', 'euro area': '0025',
  usmca: '0020', nafta: '0020', asean: '0027', oecd: '0022', nato: '0023',
  apec: '0026', 'pacific rim': '0014',
  europe: '4XXX', asia: '5XXX', africa: '7XXX', 'north america': '1XXX',
  'central america': '2XXX', 'south america': '3XXX', oceania: '6XXX',
};

const normalizeCountry = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Resolve whatever the caller gave us into a Census CTY_CODE.
 * Returns undefined only when the caller asked for no country at all — an
 * unrecognized value throws rather than quietly widening the query worldwide.
 */
function resolveCountry(args: Record<string, unknown>): string | undefined {
  const code = typeof args.country_code === 'string' ? args.country_code.trim() : '';
  const name = typeof args.country === 'string' ? args.country.trim() : '';
  const raw = code || name;
  if (!raw) return undefined;
  // Already a Census code: 4 digits, a "00nn" bloc, or a "<digit>XXX" continent.
  if (/^\d{4}$/.test(raw) || /^\dXXX$/i.test(raw)) return raw.toUpperCase();
  const hit = COUNTRY_CODES[normalizeCountry(raw)];
  if (hit) return hit;
  throw new Error(
    `user_error: "${raw}" is not a country this pack can resolve. Census foreign trade uses its own ` +
      `Schedule C codes — Mexico is "2010", China is "5700" — which are NOT ISO codes, so "MX" or "CN" ` +
      `will not work. Pass a plain English country name in \`country\` (e.g. "Mexico", "South Korea", ` +
      `"European Union") and it is resolved for you, pass a 4-digit Schedule C code in \`country_code\` ` +
      `if you already have one, or omit both to get all countries combined.`,
  );
}

type CensusRow = string[];
type CensusResponse = CensusRow[];

// Per-request ceiling on the Census API. Measured end-to-end through the
// gateway 2026-08-27: one country + one year of monthly HS2 rows takes ~32s,
// bounded by hs_code ~21s, and all-countries never returns. 20s is above the
// bounded cases and well below the gateway budget, so a query that blows it is
// genuinely too wide rather than merely slow.
const CENSUS_TIMEOUT_MS = 20_000;

async function fetchCensus(
  apiKey: string,
  endpoint: string,
  params: Record<string, string>,
): Promise<CensusResponse> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  // Census timeseries endpoints redirect to /data/missing_key.html (HTML)
  // when the key is missing — that's the historical "Unexpected token '<'"
  // failure mode the gateway used to hit before this pack got wired to
  // PLATFORM_CENSUS_KEY.
  if (apiKey) url.searchParams.set('key', apiKey);

  // Census has no timeout of its own, and an unbounded intltrade query does not
  // fail — it just never finishes. Measured 2026-08-27: an all-countries monthly
  // query ran past 116s and the gateway gave up first, so the caller got a dead
  // connection instead of a message. Bound it here, once, for every tool in the
  // pack: a slow upstream is an upstream problem and should say so.
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(CENSUS_TIMEOUT_MS) }).catch((e) => {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error(
        `upstream_down: Census did not answer within ${CENSUS_TIMEOUT_MS / 1000}s. ` +
          'This query asks for more rows than the API will return in time — narrow it with a country or a more specific hs_code.',
      );
    }
    throw e;
  });
  // Read as text first so we can give a useful error when Census returns HTML
  // (key-missing redirect) or an empty body (query period not yet published).
  // res.json() on either case throws the opaque "Unexpected end of JSON input"
  // that was masking these two failure modes in error logs.
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Census API error: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  }

  if (!text.trim()) {
    throw new Error('Census API returned no data for this query');
  }

  let data: CensusResponse;
  try {
    data = JSON.parse(text) as CensusResponse;
  } catch {
    const preview = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(`Census API returned an unreadable response — ${preview || '(empty)'}`);
  }

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
  apiKey: string,
  hsCode: string,
  year: string,
  countryCode?: string,
  month?: string,
  limit: number = 20,
) {
  // hsCode is optional — a "total imports from <country>" query omits it, and the
  // router routinely does. `undefined.length` used to crash ("Cannot read
  // properties of undefined (reading 'length')"). Guard it; with no commodity,
  // request HS2 across all commodities (omit the I_COMMODITY filter).
  const code = (hsCode ?? '').trim();
  const commLvl = code.length === 0 || code.length <= 2 ? 'HS2' : code.length <= 4 ? 'HS4' : 'HS6';
  const params: Record<string, string> = {
    get: 'GEN_VAL_MO,GEN_QY1_MO,I_COMMODITY,CTY_CODE,CTY_NAME',
    COMM_LVL: commLvl,
    time: month ? `${year}-${month}` : year,
  };
  if (code) params.I_COMMODITY = code;
  if (countryCode) {
    params.CTY_CODE = countryCode;
  }

  const data = await fetchCensus(apiKey, 'imports/hs', params);
  const records = parseRows(data, limit);

  return {
    type: 'US Imports',
    hs_code: code || 'all commodities',
    // Always state what was actually filtered on. Without this an unfiltered
    // worldwide response is indistinguishable from a country-specific one.
    country_code: countryCode ?? 'all countries',
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
  apiKey: string,
  hsCode: string,
  year: string,
  countryCode?: string,
  month?: string,
  limit: number = 20,
) {
  // hsCode is optional (see getImports) — guard against undefined.length and, with
  // no commodity, request HS2 across all commodities rather than crashing.
  const code = (hsCode ?? '').trim();
  const commLvl = code.length === 0 || code.length <= 2 ? 'HS2' : code.length <= 4 ? 'HS4' : 'HS6';
  const params: Record<string, string> = {
    get: 'ALL_VAL_MO,QTY_1_MO,E_COMMODITY,CTY_CODE,CTY_NAME',
    COMM_LVL: commLvl,
    time: month ? `${year}-${month}` : year,
  };
  if (code) params.E_COMMODITY = code;
  if (countryCode) {
    params.CTY_CODE = countryCode;
  }

  const data = await fetchCensus(apiKey, 'exports/hs', params);
  const records = parseRows(data, limit);

  return {
    type: 'US Exports',
    hs_code: code || 'all commodities',
    // Always state what was actually filtered on (see getImports).
    country_code: countryCode ?? 'all countries',
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

async function getTradeBalance(apiKey: string, countryCode: string, year: string) {
  // Census enduse with `time=YYYY` returns 12 monthly rows whose GEN_VAL_YR
  // is YEAR-TO-DATE cumulative. Summing all 12 = summing cumulative running
  // totals ≈ 6.5× the real annual figure (probe of US/China 2024 reported
  // a $1.8T deficit vs. the real ~$295B). Query December only so the single
  // returned YTD equals the full-year total — then sum across end-use
  // categories which DO partition the country total.
  const yearMonth = `${year}-12`;
  const [importsData, exportsData] = await Promise.all([
    fetchCensus(apiKey, 'imports/enduse', {
      get: 'GEN_VAL_YR,CTY_CODE,CTY_NAME',
      CTY_CODE: countryCode,
      time: yearMonth,
    }),
    fetchCensus(apiKey, 'exports/enduse', {
      get: 'ALL_VAL_YR,CTY_CODE,CTY_NAME',
      CTY_CODE: countryCode,
      time: yearMonth,
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
  apiKey: string,
  startYear: string | undefined,
  endYear: string | undefined,
  hsCode?: string,
  countryCode?: string,
) {
  // Without a country filter Census returns EVERY trading partner, at every HS2
  // chapter, for every month. Measured through the gateway 2026-08-27: China +
  // 2024 answers in 32s; the same year with no country never returns (77s and
  // 116s runs, both killed by the gateway), and narrowing to a single hs_code
  // does not save it — breadth across countries is what costs, not commodities.
  // The old schema advertised "omit for all countries", so the shape a caller
  // reaches for first was the one shape that could not work, and it failed by
  // hanging rather than by saying anything. Refuse it in a millisecond instead,
  // and name the tool that does answer the all-countries question.
  if (!countryCode) {
    throw new Error(
      'user_error: census_trade_trends needs a country — pass `country` with a plain English name ' +
        '(e.g. "China") or `country_code` with a 4-digit Census Schedule C code. An unfiltered monthly ' +
        'trend spans every trading partner and the Census API cannot return it before the request times ' +
        'out. For all-countries totals use census_imports or census_exports, which are annual and bounded.',
    );
  }

  // Census foreign-trade data publishes on a lag, so "the latest year" is
  // last calendar year, not the current one (a bare `new Date()` call is
  // fine here — this runs per-request, never at module scope).
  const lastPublishedYear = new Date().getFullYear() - 1;
  const endYr = endYear ? parseInt(endYear, 10) : lastPublishedYear;
  // ONE year by default, not three. Each year is two Census requests of ~20-30s,
  // so the old three-year default spent the entire gateway budget before it had
  // an answer — the reason a bare call looked broken rather than slow.
  const startYr = startYear ? parseInt(startYear, 10) : endYr;
  if (Number.isNaN(startYr) || Number.isNaN(endYr)) {
    throw new Error(`user_error: start_year and end_year must be 4-digit years. Got start_year="${startYear}", end_year="${endYear}".`);
  }
  if (endYr < startYr) {
    throw new Error(`user_error: end_year (${endYr}) is before start_year (${startYr}).`);
  }
  if (endYr - startYr > 2) {
    throw new Error(
      `user_error: ${startYr}-${endYr} is ${endYr - startYr + 1} years; this tool fetches monthly rows per year ` +
        'and more than 3 cannot be returned before the request times out. Ask for a narrower span.',
    );
  }

  // Census's timeseries endpoint takes a BARE year (or YYYY-MM). The
  // `from X to Y` range syntax appears nowhere in its docs and returns nothing,
  // so this tool answered every question with `trends: []` while its siblings —
  // getImports/getExports/getTradeBalance, same endpoint, same CTY_CODE and
  // COMM_LVL — returned real data for the identical country and year. One
  // request per year, merged, matching the shape that works.
  const years: string[] = [];
  for (let y = startYr; y <= endYr; y++) years.push(String(y));

  // Without COMM_LVL the Census API returns data at ALL commodity levels
  // (HS2 + HS4 + HS6), which produces tens of thousands of rows and causes
  // res.json() to fail with "Unexpected end of JSON input" when the response
  // is truncated in transit. Default to HS2 (same logic as getImports) so the
  // no-hs_code case returns aggregate monthly data rather than a firehose.
  const defaultCommLvl = hsCode
    ? (hsCode.length <= 2 ? 'HS2' : hsCode.length <= 4 ? 'HS4' : 'HS6')
    : 'HS2';

  const importParams: Record<string, string> = {
    // `time` is a FILTER on this endpoint, not a requestable variable — asking
    // for it in `get` is what produced "unknown variable 'time'". Census returns
    // the time column implicitly when you filter on it, which is why the sibling
    // getImports/getExports (which omit it here) have always worked.
    // Mirrors getImports' proven-working `get` list. Census wants the commodity
    // variable named alongside COMM_LVL; omitting it returned an empty body.
    get: 'GEN_VAL_MO,I_COMMODITY,CTY_CODE,CTY_NAME',
    COMM_LVL: defaultCommLvl,
  };
  const exportParams: Record<string, string> = {
    get: 'ALL_VAL_MO,E_COMMODITY,CTY_CODE,CTY_NAME',
    COMM_LVL: defaultCommLvl,
  };

  if (hsCode) {
    importParams.I_COMMODITY = hsCode;
    exportParams.E_COMMODITY = hsCode;
  }
  if (countryCode) {
    importParams.CTY_CODE = countryCode;
    exportParams.CTY_CODE = countryCode;
  }

  // Errors are COLLECTED, not swallowed. The previous `.catch(() => null)` on
  // both calls turned a failing upstream into `trends: []` and reported it as a
  // clean success — 14 days of telemetry show only class:success for this tool
  // and not one error, while it was returning nothing at all. A tool that
  // cannot tell "no trade" from "the request was rejected" is worse than one
  // that errors.
  const problems: string[] = [];
  const perYear = await Promise.all(
    years.map(async (year) => {
      const [imp, exp] = await Promise.all([
        fetchCensus(apiKey, 'imports/hs', { ...importParams, time: year }).catch((e) => {
          problems.push(`imports ${year}: ${String(e).slice(0, 80)}`);
          return null;
        }),
        fetchCensus(apiKey, 'exports/hs', { ...exportParams, time: year }).catch((e) => {
          problems.push(`exports ${year}: ${String(e).slice(0, 80)}`);
          return null;
        }),
      ]);
      return { imp, exp };
    }),
  );

  // The 200-row cap silently truncated the SERIES, not just the response: rows
  // come back per commodity chapter per month (~97 HS2 chapters x 12 months), so
  // 200 rows covered barely three months and the tool reported `months: 3` for a
  // full year as though that were the whole answer. Cap high enough to hold a
  // year of HS2 rows; COMM_LVL keeps the breadth bounded, which is what the
  // original cap was actually guarding against.
  const PER_YEAR_ROW_CAP = 2400;
  const importRecords = perYear.flatMap((r) => (r.imp ? parseRows(r.imp, PER_YEAR_ROW_CAP) : []));
  const exportRecords = perYear.flatMap((r) => (r.exp ? parseRows(r.exp, PER_YEAR_ROW_CAP) : []));

  if (importRecords.length === 0 && exportRecords.length === 0 && problems.length > 0) {
    throw new Error(`Census trade timeseries unavailable (${problems.slice(0, 3).join('; ')})`);
  }

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

  // Echo the country we actually resolved to. Until now the only country signal
  // in this payload was `country_code: "5700"` — a Census Schedule C code, not
  // an ISO one, which no caller supplied and no agent should be expected to
  // recognise. Someone asks about China, gets back a number, and has no way to
  // confirm the answer is even about China. The golden
  // `trade--export-ops--china-deficit-direction` has been failing on exactly
  // that ("response missing 'china'") while the numbers underneath were right.
  //
  // Nothing had to be fetched for this: the `get` lists above have always
  // requested CTY_NAME, and getTradeBalance already echoes it the same way. The
  // name was in hand and simply never made it into the response.
  const countryName = importRecords[0]?.CTY_NAME || exportRecords[0]?.CTY_NAME;
  return {
    start_year: String(startYr),
    end_year: String(endYr),
    hs_code: hsCode || 'all',
    country: countryName || (countryCode ? countryCode : 'all'),
    country_code: countryCode || 'all',
    months: trends.length,
    trends,
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  // Gateway injects PLATFORM_CENSUS_KEY as args._apiKey for anonymous/OAuth
  // callers; BYO users can pass their own key the same way. We strip it from
  // args before dispatching so downstream functions don't see it.
  const apiKey = (args._apiKey as string | undefined) ?? '';
  delete args._apiKey;

  // Resolve ONCE, up front, for every tool — a country the caller named but we
  // could not resolve must never reach the fetch as "no filter".
  const country = resolveCountry(args);

  switch (name) {
    case 'census_imports':
      return getImports(
        apiKey,
        args.hs_code as string,
        args.year as string,
        country,
        args.month as string | undefined,
        (args.limit as number) || 20,
      );
    case 'census_exports':
      return getExports(
        apiKey,
        args.hs_code as string,
        args.year as string,
        country,
        args.month as string | undefined,
        (args.limit as number) || 20,
      );
    case 'census_trade_balance':
      if (!country) {
        throw new Error(
          'user_error: census_trade_balance needs a country — pass `country` with a plain English ' +
            'name (e.g. "Mexico") or `country_code` with a 4-digit Census Schedule C code. ' +
            'A trade balance is always bilateral, so there is no all-countries form of this tool.',
        );
      }
      return getTradeBalance(apiKey, country, args.year as string);
    case 'census_trade_trends':
      return getTradeTrends(
        apiKey,
        args.start_year as string,
        args.end_year as string,
        args.hs_code as string | undefined,
        country,
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 5 } } satisfies McpToolExport;
