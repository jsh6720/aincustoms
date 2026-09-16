// Run interactively on the owner's PC. Never pass a real password as a CLI argument.
const crypto = require('node:crypto');
const readline = require('node:readline');
const { Writable } = require('node:stream');
async function hidden(prompt) {
  process.stdout.write(prompt);
  const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  try { return await new Promise(resolve => rl.question('', resolve)); }
  finally { rl.close(); process.stdout.write('\n'); }
}
(async () => {
  if (!process.stdin.isTTY) throw new Error('터미널에서 직접 실행해 주세요. 비밀번호를 명령줄이나 채팅에 입력하지 마세요.');
  console.log('AIN 내부 공유 비밀번호 설정값 생성. 입력한 비밀번호는 화면에 표시되지 않습니다.');
  const password = await hidden('새 공유 비밀번호 (12자 이상): ');
  if (password.length < 12 || Buffer.byteLength(password) > 1024) throw new Error('12자 이상, 1024바이트 이하의 비밀번호를 사용해 주세요.');
  if (password !== await hidden('다시 입력: ')) throw new Error('비밀번호가 일치하지 않습니다.');
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  console.log('\n아래 두 값을 Vercel > Settings > Environment Variables에 각각 등록하세요.');
  console.log('이 값들도 외부에 공유하지 마세요. 실제 비밀번호는 출력되지 않습니다.\n');
  console.log('INTERNAL_SHARE_PASSWORD_HASH=scrypt:' + salt.toString('base64url') + ':' + key.toString('base64url'));
  console.log('INTERNAL_SHARE_SESSION_SECRET=' + crypto.randomBytes(32).toString('base64url'));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
