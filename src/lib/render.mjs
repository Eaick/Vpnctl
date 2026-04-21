export function info(message = '') {
  console.log(`[info] ${message}`);
}

export function ok(message = '') {
  console.log(`[ok] ${message}`);
}

export function warn(message = '') {
  console.log(`[warn] ${message}`);
}

export function fail(message = '') {
  console.error(`[error] ${message}`);
}

export function title(message = '') {
  console.log(`\n=== ${message} ===`);
}

export function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}
