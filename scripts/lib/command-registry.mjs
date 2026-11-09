// The list ends at its closing bracket. References later in main.rs prove no command is registered.
export function registeredCommands(source) {
  const match = source.match(/generate_handler!\s*\[([\s\S]*?)\]/);
  if (!match) throw new Error('main.rs has no command registry');
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const commands = body.split(',').map(value => value.trim()).filter(Boolean);
  if (!commands.length || commands.some(value => !/^[a-z_][a-z0-9_]*$/.test(value))) {
    throw new Error('unrecognised command registry entry');
  }
  return new Set(commands);
}
