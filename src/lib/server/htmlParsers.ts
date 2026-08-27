import * as cheerio from 'cheerio';

export type MasterData = Record<string, Record<string, string>>;

/**
 * Converts addmodel_new_all.php's full page into JSON, keyed by each
 * <select>'s `name` attribute. Values are { "Display Text": "value" }.
 * Ported from the original client-side htmlToJson (apiUtils.ts), which
 * used the browser's DOMParser — that doesn't exist in Node, so this
 * uses cheerio instead. Behavior is otherwise identical: only meaningless
 * whitespace around tag content is trimmed, real option text spacing is
 * preserved so downstream exact-match validation stays reliable.
 */
export function htmlToJson(htmlString: string): MasterData {
  const $ = cheerio.load(htmlString);
  const result: MasterData = {};

  $('select').each((_, select) => {
    const name = $(select).attr('name');
    if (!name) return;

    const options: Record<string, string> = {};
    $(select)
      .find('option')
      .each((_, option) => {
        const value = ($(option).attr('value') ?? '').trim();
        const text = $(option).text().trim();
        if (value && text && text !== 'Please Select') {
          options[text] = value;
        }
      });

    result[name] = options;
  });

  return result;
}

/**
 * Parses a getField.php option-list HTML fragment into an EXACT
 * { "Display Text": "id" } map — original casing and spacing preserved.
 * Kept regex-based (not cheerio) because it operates on a small,
 * well-known fragment shape, matching the original parseHtmlOptionsExact
 * (apiUtils.ts) exactly.
 */
export function parseHtmlOptionsExact(htmlString: string): Record<string, string> {
  const map: Record<string, string> = {};
  const regex = /<option\s+value=["']([^"']*)["'][^>]*>([^<]*)<\/option>/gi;

  let match;
  while ((match = regex.exec(htmlString)) !== null) {
    const id = match[1].trim();
    const text = match[2].trim();
    if (id && text && text !== 'Please Select') {
      map[text] = id;
    }
  }
  return map;
}

/**
 * Detects whether a legacy response is actually the login page rather
 * than the authenticated page we asked for — the signal we'd otherwise
 * miss silently if the session cookie is missing or has expired
 * server-side. Checked before caching ANYTHING globally (master-data,
 * field-options), since caching a logged-out response would poison it
 * for every user until the cache TTL/invalidation clears it. Also
 * checked (without caching implications) before parsing search/submit
 * responses, so an expired session surfaces as a clear 401 instead of
 * silently parsing zero rows or a confusing "failure" message.
 */
export function looksLikeLoginPage(html: string): boolean {
  return html.includes('name="login_form"') || html.includes('id="login_form"');
}

// ---------------------------------------------------------------------------
// Model Master search — used by /api/models/search to discover the
// auto-generated Model Code after a create (addmodel_new_all.php's submit
// response doesn't include it directly).
// ---------------------------------------------------------------------------

export interface ModelListRow {
  sno: string;
  modelCode: string;
  brand: string;
  product: string;
  model: string;
  modelDesc: string;
  editId: string | null;
  status: string;
}

/**
 * Parses model_master_new.php's search-results HTML into structured rows.
 * Table layout: SNO | Model Code | Brand | Product | Model | Model Desc |
 * Edit | Image Upload | Status. Ported from the original DOMParser-based
 * parseModelListHtml (apiUtils.ts) to cheerio, since DOMParser doesn't
 * exist in Node.
 */
export function parseModelListHtml(html: string): ModelListRow[] {
  const $ = cheerio.load(html);
  const rows: ModelListRow[] = [];

  $('table.hovertable tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 9) return; // header/spacer rows use <th> or fewer cells

    const cellText = (i: number) => $(cells.get(i)).text().trim();

    const sno = cellText(0);
    if (!/^\d+$/.test(sno)) return; // guard: a real data row starts with a plain row number

    const modelCode = cellText(1);
    const brand = cellText(2);
    const product = cellText(3);
    const model = cellText(4);
    const modelDesc = cellText(5);
    const status = cellText(8);

    // Pull the numeric id out of the Edit link's onclick:
    // edit_model_new.php?id=1849
    const editLink = $(cells.get(6)).find('a').first();
    const onclick = editLink.attr('onclick') || '';
    const idMatch = onclick.match(/edit_model_new\.php\?id=(\d+)/);
    const editId = idMatch ? idMatch[1] : null;

    rows.push({ sno, modelCode, brand, product, model, modelDesc, editId, status });
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Legacy submit-response parsing — used by /api/models/submit.
// ---------------------------------------------------------------------------

/**
 * addmodel_new_all.php was built for popup-window submission — it replies
 * with a raw HTML fragment like:
 *   <script>alert('Model Already Available...');</script>
 *   <BODY onLoad='window.close(); window.opener.location.reload(true);'></BODY>
 * None of that JS runs server-side (no window/opener here either), so we
 * just get the string back. This pulls the alert() text out and
 * classifies it as success or failure — DO NOT assume "no HTTP error"
 * means "row was actually saved". Pure string/regex logic, unchanged
 * from the original parseLegacyFormResponse (apiUtils.ts) — never needed
 * DOM parsing.
 */
export interface LegacyFormResult {
  success: boolean;
  message: string;
}

const FAILURE_KEYWORDS = ['already available', 'already exist', 'error', 'fail', 'invalid', 'duplicate'];
const SUCCESS_KEYWORDS = ['added successfully', 'success', 'record added', 'saved', 'inserted'];

export function parseLegacyFormResponse(html: string): LegacyFormResult {
  if (typeof html !== 'string') {
    return { success: false, message: 'Unexpected response from server (not text).' };
  }

  // Most responses use <script>alert('...')</script>, but some (like the
  // plain "Model has been inserted....." success page) have no alert() at
  // all — just text wrapped directly in <BODY>. Try alert() first, then
  // fall back to the page's stripped plain text.
  const alertMatch = html.match(/alert\((['"])(.*?)\1\)/i);
  let message = alertMatch ? alertMatch[2].trim() : '';

  if (!message) {
    message = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (!message) {
    return { success: false, message: 'No confirmation message received from server.' };
  }

  const lower = message.toLowerCase();
  const isFailure = FAILURE_KEYWORDS.some((k) => lower.includes(k));
  const isSuccess = SUCCESS_KEYWORDS.some((k) => lower.includes(k));

  // Explicit failure keyword wins even if a success keyword also appears.
  const success = isFailure ? false : isSuccess ? true : false;

  return { success, message };
}