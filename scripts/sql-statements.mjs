// Schema files contain CREATE TRIGGER bodies with internal semicolons.
export function sqlStatements(source){
  let remaining=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*--.*$/gm,'').trim();
  const statements=[];
  while(remaining){
    const trigger=/^CREATE\s+TRIGGER\b/i.test(remaining);
    const end=trigger?/\bEND\s*;/i.exec(remaining):/;/.exec(remaining);
    if(!end)throw Error('Unterminated schema statement.');
    const length=end.index+end[0].length;
    statements.push(remaining.slice(0,length));remaining=remaining.slice(length).trim();
  }
  return statements;
}
