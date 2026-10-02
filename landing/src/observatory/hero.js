// The first screen. Over the sky: the wordmark, one line of description, and
// the live block height at 160 px in the display serif; along the bottom,
// the river as a thin strip (drawn by the chain pulse instrument, which owns
// the stream). Nothing here fetches on its own schedule: the height is the
// hero's head carried on the page bus with its record, and the count of
// agents working now is the same `/v1/agents` read the constellation and
// the sky make, shared through the scheduler, read for one more figure.
//
// "Working now" means holding at least one open agreement
// (`activeEscrowCount` > 0): an agent with money in escrow against work
// under way. An agent that is registered but idle is not working, and the
// register's own count is the constellation's figure, not this one. When the
// list the index served was cut short, the figure says it counts those listed.

const AGENTS_INTERVAL_MS = 60_000;
const AGENT_PAGES = 3; // the same read the constellation makes, so it is fetched once

/** Agents holding an open agreement, from the rows of `/v1/agents`. A row without the field is a missing field. Pure; tested. */
export function agentsWorking(rows, field = defaultField) {
  let n = 0;
  for (const row of rows) if (Number(field(row, 'activeEscrowCount')) > 0) n += 1;
  return n;
}

/** The unit after the figure: " agents working now", honest about a cut-short list. Pure; tested. */
export function workingUnit(n, { complete = true } = {}) {
  return ` agent${n === 1 ? '' : 's'} working now${complete ? '' : ', of those listed'}`;
}

export function workingSentence(n, options) {
  return `${n}${workingUnit(n, options)}`;
}

function defaultField(data, path) {
  if (data === null || typeof data !== 'object' || !(path in data)) throw new Error(`missing field "${path}"`);
  return data[path];
}

export function init(root, ctx) {
  if (!root) return null;
  const height = ctx.reading('heroHeight', root);
  const working = ctx.reading('agentsWorking', root);

  // The height: a live head or a polled height, shown with the record it came from, like the hero's own reading.
  const onNumber = ({ record, number }) => {
    if (!height) return;
    if (!record?.ok) {
      ctx.readout.showError(height, record);
      return;
    }
    if (Number.isFinite(number)) ctx.readout.showValue(height, record, { value: number, motion: ctx.motion });
  };
  ctx.bus.on('head', onNumber);
  ctx.bus.on('poll', onNumber);

  if (working) {
    ctx.watchAll(
      'agents',
      (record) => {
        ctx.readout.apply(working, record, () => {
          const n = agentsWorking(record.items, ctx.field);
          ctx.readout.showValue(working, record, {
            value: n,
            unit: workingUnit(n, { complete: record.complete !== false }),
            extra: 'agents holding at least one open agreement',
            motion: ctx.motion,
          });
        });
      },
      AGENTS_INTERVAL_MS,
      { maxPages: AGENT_PAGES },
    );
  }
  return { height, working };
}
