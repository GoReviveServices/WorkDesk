import * as cheerio from 'cheerio';

export type MasterData = Record<string, Record<string, string>>;

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

export function looksLikeLoginPage(html: string): boolean {
  return html.includes('name="login_form"') || html.includes('id="login_form"');
}