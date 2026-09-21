import { Router } from 'express';
import { query } from '../db.js';
import { notFound } from './errors.js';
import { parseId, validate } from './validate.js';

/**
 * Builds a REST router (list / get / create / update / delete) for one table.
 *
 *  table      – table name to write to
 *  alias      – the table's alias inside `selectSql`
 *  schema     – validation schema; its keys are the only writable columns
 *  selectSql  – SELECT … FROM … (with joins) used for reads, no WHERE/ORDER BY
 *  orderBy    – ORDER BY clause for lists
 *  filters    – optional (reqQuery, addParam) => array of WHERE clauses
 *  onCreate   – optional (row, req) => void, called after a successful create
 *
 * Column and table names come from this code, never from the request, and every
 * value is passed as a query parameter.
 */
export function crudRouter({ table, alias, schema, selectSql, orderBy, filters, onCreate }) {
  const router = Router();

  async function findById(id) {
    const { rows } = await query(`${selectSql} WHERE ${alias}.id = $1`, [id]);
    if (rows.length === 0) throw notFound(`That ${table.replace(/s$/, '')} could not be found.`);
    return rows[0];
  }

  router.get('/', async (req, res) => {
    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    const clauses = filters ? filters(req.query, addParam) : [];
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await query(`${selectSql} ${where} ORDER BY ${orderBy}`, params);
    res.json(rows);
  });

  router.get('/:id', async (req, res) => {
    res.json(await findById(parseId(req.params.id)));
  });

  router.post('/', async (req, res) => {
    const data = validate(schema, req.body);
    const cols = Object.keys(data);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const { rows } = await query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
      Object.values(data),
    );
    const created = await findById(rows[0].id);
    res.status(201).json(created);
    onCreate?.(created, req);
  });

  router.put('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const data = validate(schema, req.body, { partial: true });
    const cols = Object.keys(data);
    const assignments = cols.map((col, i) => `${col} = $${i + 1}`);
    const { rowCount } = await query(
      `UPDATE ${table} SET ${assignments.join(', ')} WHERE id = $${cols.length + 1}`,
      [...Object.values(data), id],
    );
    if (rowCount === 0) throw notFound();
    res.json(await findById(id));
  });

  router.delete('/:id', async (req, res) => {
    const { rowCount } = await query(`DELETE FROM ${table} WHERE id = $1`, [parseId(req.params.id)]);
    if (rowCount === 0) throw notFound();
    res.status(204).end();
  });

  return router;
}
