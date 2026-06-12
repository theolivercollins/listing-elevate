import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth.js';
import { CreatomateProvider } from '../../../lib/providers/creatomate.js';

// Env vars the template resolver reads (lib/assembly/template-resolver.ts).
const TEMPLATE_ENV_VARS = [
  'CREATOMATE_TEMPLATE_ID_JUST_LISTED_15',
  'CREATOMATE_TEMPLATE_ID_JUST_LISTED',
  'CREATOMATE_TEMPLATE_ID_JUST_PENDED',
  'CREATOMATE_TEMPLATE_ID_JUST_CLOSED',
  'CREATOMATE_TEMPLATE_ID_LIFE_CYCLE',
  'CREATOMATE_TEMPLATE_ID_DEFAULT',
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const provider = new CreatomateProvider();
  const templates = await Promise.all(
    TEMPLATE_ENV_VARS
      .map((envVar) => ({ envVar, templateId: process.env[envVar] }))
      .filter((t): t is { envVar: string; templateId: string } => Boolean(t.templateId))
      .map(async ({ envVar, templateId }) => {
        try {
          const tpl = await provider.getTemplate(templateId);
          // "Brand.phone"-style dynamic fields: element name + each dynamic property.
          // Creatomate sometimes returns `dynamic` as a boolean — guard here too
          // (defense in depth; getTemplate already normalizes to an array).
          const fields = tpl.elements.flatMap((e) =>
            Array.isArray(e.dynamic) ? e.dynamic.map((d) => `${e.name}.${d}`) : [],
          );
          return { env_var: envVar, template_id: templateId, name: tpl.name, fields };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { env_var: envVar, template_id: templateId, name: null, fields: [], error: msg };
        }
      }),
  );
  return res.status(200).json({ templates });
}
