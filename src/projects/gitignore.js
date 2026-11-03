// Kleiner .gitignore-Matcher (deckt die üblichen Muster ab: *, **, ?, /-Anker, Ordner/, !Negation).

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return re;
}

export function compileGitignore(text) {
  const rules = [];
  for (let line of (text || '').split(/\r?\n/)) {
    line = line.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    let negate = false;
    if (line.startsWith('!')) { negate = true; line = line.slice(1); }
    let dirOnly = false;
    if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1); }
    const anchored = line.includes('/');
    line = line.replace(/^\//, '');
    const body = globToRegex(line);
    const regex = new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`);
    rules.push({ regex, negate, dirOnly });
  }
  return function isIgnored(path, isDir = false) {
    // Prüft Datei und alle Elternordner
    const parts = path.split('/');
    let ignored = false;
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join('/');
      const subIsDir = i < parts.length || isDir;
      for (const r of rules) {
        if (r.dirOnly && !subIsDir) continue;
        if (r.regex.test(sub)) ignored = !r.negate;
      }
      if (ignored && i < parts.length) return true;
    }
    return ignored;
  };
}
