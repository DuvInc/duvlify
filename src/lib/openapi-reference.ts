/**
 * Build-time OpenAPI reader for endpoint pages.
 *
 * Endpoint pages carry only method/path identity in frontmatter; this module
 * resolves the operation against the document in src/openapi.config.ts and
 * derives the richer UI model used by the API code rail. The spec therefore
 * remains the single source of truth, and no endpoint page restates it.
 */
import { openapiSpec as spec } from '../openapi.config';

export interface ApiAuthorization {
  name: string;
  location: string;
  type: string;
  required: boolean;
}

export interface ApiResponseExample {
  status: string;
  description: string;
  contentType: string;
  code: string;
  fields: ApiSchemaField[];
}

export interface ApiSchemaField {
  name: string;
  type: string;
  description: string;
  required: boolean;
  children: ApiSchemaField[];
}

export interface ApiRequestExample {
  id: 'curl' | 'python' | 'javascript' | 'php' | 'go' | 'java' | 'ruby';
  label: string;
  icon: string;
  language: string;
  code: string;
}

export interface ApiReference {
  method: string;
  path: string;
  operationId?: string;
  tag?: string;
  description: string;
  server: string;
  authorizations: ApiAuthorization[];
  requests: ApiRequestExample[];
  responses: ApiResponseExample[];
}

interface ApiPageData {
  apiMethod?: string;
  apiPath?: string;
  apiOperationId?: string;
  apiTag?: string;
  description: string;
}

function getSpec() {
  return spec as any;
}

export function getApiReference(data: ApiPageData): ApiReference | undefined {
  if (!data.apiMethod || !data.apiPath) return undefined;

  const spec = getSpec();
  const method = data.apiMethod.toLowerCase();
  const pathItem = spec.paths?.[data.apiPath];
  const operation = pathItem?.[method];
  if (!operation) {
    throw new Error(`OpenAPI operation ${data.apiMethod} ${data.apiPath} is missing from public/openapi.yaml.`);
  }

  const server = operation.servers?.[0]?.url ?? pathItem.servers?.[0]?.url ?? spec.servers?.[0]?.url ?? '';
  const parameters = resolveParameters(spec, pathItem, operation);
  const bodySchema = resolveRef(spec, operation.requestBody)?.content?.['application/json']?.schema;

  return {
    method: data.apiMethod,
    path: data.apiPath,
    operationId: data.apiOperationId ?? operation.operationId,
    tag: data.apiTag ?? operation.tags?.[0],
    description: operation.description ?? operation.summary ?? data.description,
    server,
    authorizations: resolveAuthorizations(spec, operation),
    requests: requestExamples({ spec, operation, method, route: data.apiPath, server, parameters, bodySchema }),
    responses: resolveResponses(spec, operation),
  };
}

function resolveAuthorizations(spec: any, operation: any): ApiAuthorization[] {
  const requirements = operation.security ?? spec.security ?? [];
  const schemes = spec.components?.securitySchemes ?? {};
  const names = new Set<string>(requirements.flatMap((requirement: Record<string, unknown>) => Object.keys(requirement)));

  return [...names].map(key => {
    const scheme = resolveRef(spec, schemes[key]) ?? {};
    return {
      name: scheme.name ?? (scheme.scheme === 'bearer' ? 'Authorization' : key),
      location: scheme.in ?? 'header',
      type: scheme.type === 'apiKey' ? 'API key' : scheme.scheme ?? scheme.type ?? 'credential',
      required: true,
    };
  });
}

function resolveResponses(spec: any, operation: any): ApiResponseExample[] {
  return Object.entries(operation.responses ?? {}).map(([status, raw]: [string, any]) => {
    const response = resolveRef(spec, raw) ?? {};
    const contentType = Object.keys(response.content ?? {})[0] ?? 'application/json';
    const media = response.content?.[contentType] ?? {};
    const explicit = media.example ?? firstExample(media.examples);
    const value = explicit ?? exampleValue(spec, media.schema, 0, new Set(), 'response');
    return {
      status,
      description: response.description ?? '',
      contentType,
      code: JSON.stringify(value ?? {}, null, 2),
      fields: schemaFields(spec, media.schema),
    };
  });
}

function schemaFields(spec: any, rawSchema: any): ApiSchemaField[] {
  const schema = materializeSchema(spec, rawSchema);
  const object = schema.type === 'array' ? materializeSchema(spec, schema.items) : schema;
  const required = new Set<string>(object.required ?? []);
  return Object.entries(object.properties ?? {}).map(([name, raw]: [string, any]) => {
    const field = materializeSchema(spec, raw);
    const nested = nestedSchema(spec, field);
    return {
      name,
      type: typeName(spec, field),
      description: field.description ?? '',
      required: required.has(name),
      children: schemaFields(spec, nested),
    };
  });
}

function typeName(spec: any, rawSchema: any): string {
  const schema = materializeSchema(spec, rawSchema);
  if (schema.type === 'array') return `${typeName(spec, schema.items)}[]`;
  if (schema.oneOf?.length || schema.anyOf?.length) {
    return (schema.oneOf ?? schema.anyOf).map((item: any) => typeName(spec, item)).join(' | ');
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    return `Record<string, ${typeName(spec, schema.additionalProperties)}>`;
  }
  if (schema.additionalProperties === true) return 'Record<string, unknown>';
  if (schema.nullable && schema.type) return `${schema.type} | null`;
  return schema.type ?? 'object';
}

function firstExample(examples: Record<string, any> | undefined) {
  const example = examples && Object.values(examples)[0];
  return example?.value ?? example;
}

function curlExample({ spec, operation, method, route, server, parameters, bodySchema }: any) {
  const query = parameters
    .filter((parameter: any) => parameter.in === 'query' && parameter.required)
    .map((parameter: any) => `${parameter.name}=<${parameter.name}>`)
    .join('&');
  const path = route.replace(/\{(\w+)\}/g, (_: string, name: string) => `<${name}>`);
  const url = `${server}${path}${query ? `?${query}` : ''}`;
  const lines = [`curl --request ${method.toUpperCase()} \\`, `  --url '${url}' \\`];

  for (const authorization of resolveAuthorizations(spec, operation)) {
    lines.push(`  --header '${authorization.name}: <api-key>' \\`);
  }

  if (bodySchema) {
    lines.push(`  --header 'Content-Type: application/json' \\`);
    const body = JSON.stringify(exampleValue(spec, bodySchema, 0, new Set(), 'request'), null, 2);
    lines.push(`  --data '${body}'`);
  } else {
    lines[lines.length - 1] = lines.at(-1)!.replace(/ \\$/, '');
  }
  return lines.join('\n');
}

function requestExamples(context: any): ApiRequestExample[] {
  const request = requestParts(context);
  return [
    { id: 'curl', label: 'cURL', icon: 'bash', language: 'bash', code: curlExample(context) },
    { id: 'python', label: 'Python', icon: 'python', language: 'python', code: pythonExample(request) },
    { id: 'javascript', label: 'JavaScript', icon: 'javascript', language: 'javascript', code: javascriptExample(request) },
    { id: 'php', label: 'PHP', icon: 'php', language: 'php', code: phpExample(request) },
    { id: 'go', label: 'Go', icon: 'go', language: 'go', code: goExample(request) },
    { id: 'java', label: 'Java', icon: 'java', language: 'java', code: javaExample(request) },
    { id: 'ruby', label: 'Ruby', icon: 'ruby', language: 'ruby', code: rubyExample(request) },
  ];
}

function requestParts({ spec, operation, method, route, server, parameters, bodySchema }: any) {
  const query = parameters
    .filter((parameter: any) => parameter.in === 'query' && parameter.required)
    .map((parameter: any) => `${parameter.name}=<${parameter.name}>`)
    .join('&');
  const path = route.replace(/\{(\w+)\}/g, (_: string, name: string) => `<${name}>`);
  const headers = Object.fromEntries([
    ...resolveAuthorizations(spec, operation).map(auth => [auth.name, '<api-key>']),
    ...(bodySchema ? [['Content-Type', 'application/json']] : []),
  ]);
  return {
    method: method.toUpperCase(),
    url: `${server}${path}${query ? `?${query}` : ''}`,
    headers,
    body: bodySchema ? exampleValue(spec, bodySchema, 0, new Set(), 'request') : undefined,
  };
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const quote = (value: string) => JSON.stringify(value);

function pythonExample({ method, url, headers, body }: any) {
  const lines = ['import json', 'import requests', '', `url = ${quote(url)}`, `headers = ${pretty(headers)}`];
  if (body) lines.push(`payload = json.loads(${quote(JSON.stringify(body))})`);
  lines.push('', `response = requests.request(${quote(method)}, url, headers=headers${body ? ', json=payload' : ''})`, 'print(response.json())');
  return lines.join('\n');
}

function javascriptExample({ method, url, headers, body }: any) {
  const options = [`  method: ${quote(method)},`, `  headers: ${pretty(headers).replace(/^/gm, '  ').trimStart()},`];
  if (body) options.push(`  body: JSON.stringify(${pretty(body).replace(/^/gm, '  ').trimStart()}),`);
  return [`const response = await fetch(${quote(url)}, {`, ...options, '});', '', 'const data = await response.json();', 'console.log(data);'].join('\n');
}

function phpExample({ method, url, headers, body }: any) {
  const headerLines = Object.entries(headers).map(([name, value]) => `    ${quote(`${name}: ${value}`)},`).join('\n');
  return [
    '<?php', '$client = curl_init();', '', `curl_setopt($client, CURLOPT_URL, ${quote(url)});`,
    `curl_setopt($client, CURLOPT_CUSTOMREQUEST, ${quote(method)});`,
    `curl_setopt($client, CURLOPT_HTTPHEADER, [\n${headerLines}\n]);`,
    ...(body ? [`curl_setopt($client, CURLOPT_POSTFIELDS, ${quote(JSON.stringify(body))});`] : []),
    'curl_setopt($client, CURLOPT_RETURNTRANSFER, true);', '', '$response = curl_exec($client);', 'curl_close($client);', 'echo $response;',
  ].join('\n');
}

function goExample({ method, url, headers, body }: any) {
  const source = body ? `bytes.NewBuffer([]byte(${quote(JSON.stringify(body))}))` : 'nil';
  const headerLines = Object.entries(headers).map(([name, value]) => `req.Header.Set(${quote(name)}, ${quote(String(value))})`);
  return [
    'package main', '', 'import (', ...(body ? ['  "bytes"'] : []), '  "fmt"', '  "io"', '  "net/http"', ')', '',
    'func main() {', `  req, _ := http.NewRequest(${quote(method)}, ${quote(url)}, ${source})`,
    ...headerLines.map(line => `  ${line}`), '  res, _ := http.DefaultClient.Do(req)', '  defer res.Body.Close()', '  data, _ := io.ReadAll(res.Body)', '  fmt.Println(string(data))', '}',
  ].join('\n');
}

function javaExample({ method, url, headers, body }: any) {
  const headersCode = Object.entries(headers).map(([name, value]) => `    .header(${quote(name)}, ${quote(String(value))})`);
  const publisher = body
    ? `.method(${quote(method)}, HttpRequest.BodyPublishers.ofString(${quote(JSON.stringify(body))}))`
    : `.method(${quote(method)}, HttpRequest.BodyPublishers.noBody())`;
  return [
    'import java.net.URI;', 'import java.net.http.HttpClient;', 'import java.net.http.HttpRequest;', 'import java.net.http.HttpResponse;', '',
    `var request = HttpRequest.newBuilder(URI.create(${quote(url)}))`, ...headersCode, `    ${publisher}`, '    .build();', '',
    'var response = HttpClient.newHttpClient().send(', '    request, HttpResponse.BodyHandlers.ofString());', 'System.out.println(response.body());',
  ].join('\n');
}

function rubyExample({ method, url, headers, body }: any) {
  const className: Record<string, string> = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete' };
  const headerLines = Object.entries(headers).map(([name, value]) => `request[${quote(name)}] = ${quote(String(value))}`);
  return [
    "require 'net/http'", "require 'json'", '', `uri = URI(${quote(url)})`,
    `request = Net::HTTP::${className[method] ?? 'Get'}.new(uri)`, ...headerLines,
    ...(body ? [`request.body = ${quote(JSON.stringify(body))}`] : []), '', 'response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") do |http|', '  http.request(request)', 'end', '', 'puts response.body',
  ].join('\n');
}

function exampleValue(
  spec: any,
  rawSchema: any,
  depth: number,
  seen: Set<string>,
  mode: 'request' | 'response',
): any {
  if (!rawSchema || depth > 5) return {};
  if (rawSchema.example !== undefined) return rawSchema.example;
  if (rawSchema.default !== undefined) return rawSchema.default;
  if (rawSchema.enum?.length) return rawSchema.enum[0];

  if (rawSchema.$ref) {
    if (seen.has(rawSchema.$ref)) return {};
    const nextSeen = new Set(seen).add(rawSchema.$ref);
    return exampleValue(spec, resolveRef(spec, rawSchema), depth + 1, nextSeen, mode);
  }

  const schema = rawSchema;
  if (schema.allOf?.length) {
    return schema.allOf.reduce((value: any, part: any) => mergeExamples(value, exampleValue(spec, part, depth + 1, seen, mode)), {});
  }
  if (schema.oneOf?.length || schema.anyOf?.length) {
    return exampleValue(spec, (schema.oneOf ?? schema.anyOf)[0], depth + 1, seen, mode);
  }
  if (schema.type === 'array') {
    return [exampleValue(spec, schema.items, depth + 1, seen, mode)];
  }
  if (schema.properties || schema.type === 'object') {
    const entries = Object.entries(schema.properties ?? {});
    const required = new Set<string>(schema.required ?? []);
    const selected = mode === 'request' && required.size
      ? entries.filter(([name]) => required.has(name))
      : entries;
    return Object.fromEntries(
      selected.map(([name, child]) => [name, exampleValue(spec, child, depth + 1, seen, mode)]),
    );
  }
  if (schema.format === 'date-time') return '2024-01-01T00:00:00Z';
  if (schema.format === 'date') return '2024-01-01';
  if (schema.format === 'uuid') return '550e8400-e29b-41d4-a716-446655440000';
  const primitives: Record<string, string | number | boolean> = {
    string: '<string>', integer: 123, number: 123.45, boolean: true,
  };
  return primitives[schema.type] ?? null;
}

function resolveRef(spec: any, node: any, seen = new Set<string>()) {
  if (!node?.$ref) return node;
  if (!node.$ref.startsWith('#/') || seen.has(node.$ref)) return {};
  const target = node.$ref.slice(2).split('/').map(decodePointer).reduce((value: any, key: string) => value?.[key], spec);
  return resolveRef(spec, target, new Set([...seen, node.$ref]));
}

const resolveList = (spec: any, list: any[]) => list.map(item => resolveRef(spec, item)).filter(Boolean);

function resolveParameters(spec: any, pathItem: any, operation: any) {
  const parameters = new Map<string, any>();
  for (const parameter of resolveList(spec, [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])])) {
    parameters.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...parameters.values()];
}

function materializeSchema(spec: any, rawSchema: any): any {
  const schema = resolveRef(spec, rawSchema) ?? {};
  if (!schema.allOf?.length) return schema;
  const merged = { ...schema };
  delete merged.allOf;
  for (const part of schema.allOf) {
    const resolved = materializeSchema(spec, part);
    const properties = { ...(merged.properties ?? {}), ...(resolved.properties ?? {}) };
    const required = [...new Set([...(merged.required ?? []), ...(resolved.required ?? [])])];
    Object.assign(merged, resolved);
    if (Object.keys(properties).length) merged.properties = properties;
    if (required.length) merged.required = required;
  }
  return merged;
}

function nestedSchema(spec: any, field: any) {
  const target = field.type === 'array' ? materializeSchema(spec, field.items) : field;
  if (target?.properties) return target;
  const variant = target?.oneOf?.[0] ?? target?.anyOf?.[0];
  return variant ? materializeSchema(spec, variant) : null;
}

function mergeExamples(base: any, next: any): any {
  if (base && next && typeof base === 'object' && typeof next === 'object' && !Array.isArray(base) && !Array.isArray(next)) {
    return { ...base, ...next };
  }
  return next ?? base;
}

function decodePointer(value: string) {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}
