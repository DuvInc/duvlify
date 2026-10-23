/**
 * The API reference of an endpoint page, as Markdown, for its twin.
 *
 * An endpoint page's body is prose. Everything an agent needs to call the
 * operation (auth, parameters, body, responses) is rendered from the OpenAPI
 * document by the layout, so the `.md` twin, the `fetch` tool and
 * llms-full.txt used to carry the prose and none of it. This writes the same
 * model the page renders from, so the two cannot disagree.
 *
 * Descriptions in the spec are CommonMark already and are copied as they are.
 */
import type { ApiConstraint, ApiParameter, ApiReference, ApiSchemaField } from './openapi-reference.ts';

const pills = (type: string, required: boolean, deprecated: boolean | undefined, constraints: ApiConstraint[]) =>
  [
    `\`${type}\``,
    ...(required ? ['required'] : []),
    ...(deprecated ? ['deprecated'] : []),
    ...constraints.map(constraint => `${constraint.label}: \`${constraint.value}\``),
  ].join(', ');

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();

function fieldLines(fields: ApiSchemaField[], parent = ''): string[] {
  return fields.flatMap(field => {
    const path = parent ? `${parent}.${field.name}` : field.name;
    const line = `- \`${path}\` (${pills(field.type, field.required, field.deprecated, field.constraints)})` +
      (field.description ? `: ${oneLine(field.description)}` : '');
    return [line, ...fieldLines(field.children, path)];
  });
}

const parameterLine = (parameter: ApiParameter) =>
  `- \`${parameter.name}\` (${pills(parameter.type, parameter.required, parameter.deprecated, parameter.constraints)})` +
  (parameter.description ? `: ${oneLine(parameter.description)}` : '');

const TITLES = { path: 'Path parameters', query: 'Query parameters', header: 'Header parameters', cookie: 'Cookie parameters' } as const;

export function apiMarkdown(api: ApiReference): string {
  /* Section headings match the ids the HTML page renders (`#authorizations`,
     `#query-parameters`, `#body`, `#response`), because the agent manifest
     points into the page by heading. Anything without an anchor on the page
     (the endpoint line, each status, the example) is a bold line instead. */
  const out: string[] = ['```http', `${api.method} ${api.server}${api.path}`, '```', ''];

  if (api.authorizations.length) {
    out.push('## Authorizations', '');
    for (const auth of api.authorizations) out.push(`- \`${auth.name}\` (${auth.type}, in ${auth.location}${auth.required ? ', required' : ''})`);
    out.push('');
  }

  for (const location of ['path', 'query', 'header', 'cookie'] as const) {
    const parameters = api.parameters.filter(parameter => parameter.location === location);
    if (!parameters.length) continue;
    out.push(`## ${TITLES[location]}`, '', ...parameters.map(parameterLine), '');
  }

  if (api.body) {
    out.push('## Body', '', `\`${api.body.contentType}\`${api.body.required ? ', required' : ''}`, '');
    if (api.body.description) out.push(api.body.description.trim(), '');
    if (api.body.binary) out.push('The raw bytes of the file.', '');
    if (api.body.fields.length) out.push(...fieldLines(api.body.fields), '');
  }

  if (api.responses.length) {
    out.push('## Response', '');
    for (const response of api.responses) {
      out.push(`**${response.status}**${response.description ? `: ${oneLine(response.description)}` : ''}`, '');
      if (response.fields.length) out.push(...fieldLines(response.fields), '');
      out.push(...(response.code ? ['```json', response.code, '```'] : ['No response body.']), '');
    }
  }

  const curl = api.requests.find(request => request.id === 'curl');
  if (curl) out.push('**Example request**', '', '```bash', curl.code, '```', '');

  return out.join('\n').trimEnd();
}
