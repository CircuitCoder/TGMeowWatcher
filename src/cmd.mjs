const CMDS = {
  list: [],
  refresh: [],
  link: ['target'],
  unlink: ['target'],
};

export function tryParseCall(text, uid, pm = false) {
  const matcher = new RegExp(`^([^@]+)(@${uid})?$`);

  if(text.length === 0 || text.charAt(0) !== '/') return null;

  const [cmd, ...args] = text.substr(1).split(' ');

  const matched = cmd.match(matcher);
  if(!matched) return null;

  const [, parsed, idMatch] = matched;
  const spec = CMDS[parsed];
  if(!spec) {
    if(idMatch || pm)
      return { error: 'UNKNOWN_CMD', cmd: parsed };
    else
      return null;
  }

  if(spec.length !== args.length) {
    const usage = [`/${parsed}`, ...spec].join(' ');
    return { error: 'USAGE', usage };
  }

  return {
    cmd: parsed,
    args: args.reduce((acc, cur, idx) => ({ ...acc, [spec[idx]]: cur }), {}),
  };
}
