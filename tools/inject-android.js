/**
 * Android 原生代码注入（M4-T17 / T18）
 *
 * 用法（Creator 首次 Android 构建成功之后执行）：
 *   node tools/inject-android.js
 * 可选指定原生工程目录：
 *   node tools/inject-android.js native/engine/android
 *
 * 目标目录为 Creator 生成的原生工程 native/engine/android
 * （Gradle 中 app 模块的 projectDir，Java 在 app/src，res 在 app/res，
 *   清单为 app/AndroidManifest.xml）。
 *
 * 做三件事（全部幂等，重复执行不会重复插入）：
 *   1. 复制 native/android 下的 Java 源码与 res 资源到原生工程；
 *   2. 在 AndroidManifest.xml 注入通知/小组件所需的权限与 receiver；
 *   3. 在 AppActivity.onCreate 注入原生桥初始化。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'native', 'android');
const MARK_BEGIN = 'PET_BRIDGE_BEGIN';
const MARK_END = 'PET_BRIDGE_END';
const ACTIVITY_MARK = 'PET_BRIDGE_INIT';

function log(msg) { console.log('[inject-android] ' + msg); }

function findProjectDir(argv) {
  const candidates = argv[2]
    ? [argv[2]]
    : ['native/engine/android', 'build/android/proj', 'build/android'];
  for (const rel of candidates) {
    const dir = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
    if (fs.existsSync(path.join(dir, 'app', 'AndroidManifest.xml'))) {
      return dir;
    }
  }
  return null;
}

function copyTree(from, to) {
  if (!fs.existsSync(from)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const dstPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      count += copyTree(srcPath, dstPath);
    } else {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      count++;
    }
  }
  return count;
}

function patchManifest(projDir) {
  const manifestPath = path.join(projDir, 'app', 'AndroidManifest.xml');
  let xml = fs.readFileSync(manifestPath, 'utf8');
  if (xml.includes(MARK_BEGIN)) {
    log('AndroidManifest 已注入，跳过');
    return;
  }

  const patch = fs.readFileSync(path.join(SRC, 'AndroidManifest.patch.xml'), 'utf8');
  const permissions = patch
    .split('<uses-permission')[1] !== undefined
    ? (patch.match(/<uses-permission[^>]*\/>/g) || []).join('\n    ')
    : '';
  const appFragment = (patch.match(/<application-fragment>([\s\S]*?)<\/application-fragment>/) || [, ''])[1]
    .replace(/\n\s*$/, '');

  const permissionBlock = '<!-- ' + MARK_BEGIN + ' -->\n    ' + permissions + '\n    <!-- ' + MARK_END + ' -->\n    <application';
  if (!xml.includes('<application')) {
    throw new Error('AndroidManifest.xml 中没有 <application> 节点');
  }
  xml = xml.replace('<application', permissionBlock);

  const receiverBlock = '\n        <!-- ' + MARK_BEGIN + ' -->' + appFragment + '\n        <!-- ' + MARK_END + ' -->\n    </application>';
  xml = xml.replace('</application>', receiverBlock);

  fs.writeFileSync(manifestPath, xml, 'utf8');
  log('AndroidManifest 已注入权限与 receiver');
}

function patchAppActivity(projDir) {
  const javaRoot = path.join(projDir, 'app', 'src');
  if (!fs.existsSync(javaRoot)) {
    log('未找到 app/src，跳过 AppActivity 注入');
    return;
  }

  const activityPath = findFile(javaRoot, 'AppActivity.java');
  if (!activityPath) {
    log('未找到 AppActivity.java，跳过注入');
    return;
  }

  let code = fs.readFileSync(activityPath, 'utf8');
  if (code.includes(ACTIVITY_MARK)) {
    log('AppActivity 已注入，跳过');
    return;
  }

  const marker = 'protected void onCreate(Bundle savedInstanceState)';
  const altMarker = 'public void onCreate(Bundle savedInstanceState)';
  const pos = code.includes(marker) ? code.indexOf(marker) : code.indexOf(altMarker);
  if (pos < 0) {
    log('AppActivity 中未找到 onCreate(Bundle)，请手动在 onCreate 首行加入：');
    log('  com.petcomp.game.shared.BridgeContext.init(this);');
    return;
  }

  const brace = code.indexOf('{', pos);
  if (brace < 0) {
    log('onCreate 结构异常，跳过注入');
    return;
  }

  // 尽量插在 super.onCreate(...) 之后，避免在 Activity 尚未完成基类初始化时取上下文
  const superCall = /super\.onCreate\([^)]*\)\s*;/.exec(code.slice(brace));
  const insertAt = superCall
    ? brace + superCall.index + superCall[0].length
    : brace + 1;

  const init = '\n        // ' + ACTIVITY_MARK + ': 原生桥上下文初始化\n'
    + '        com.petcomp.game.shared.BridgeContext.init(this);\n'
    + '        com.petcomp.game.notify.PetNotificationBridge.onContextReady(this);\n';

  code = code.slice(0, insertAt) + init + code.slice(insertAt);
  fs.writeFileSync(activityPath, code, 'utf8');
  log('AppActivity.onCreate 已注入桥接初始化');
}

function findFile(dir, fileName) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, fileName);
      if (found) return found;
    } else if (entry.name === fileName) {
      return full;
    }
  }
  return null;
}

function main() {
  const projDir = findProjectDir(process.argv);
  if (!projDir) {
    console.error('[inject-android] 未找到原生工程。');
    console.error('  请先在 Creator 中执行「项目 → 构建发布 → Android」一次，');
    console.error('  确认 native/engine/android/app/AndroidManifest.xml 存在后重试。');
    process.exit(1);
  }
  log('目标工程：' + projDir);

  const javaCopied = copyTree(
    path.join(SRC, 'app', 'src', 'main', 'java'),
    path.join(projDir, 'app', 'src'),
  );
  const resCopied = copyTree(
    path.join(SRC, 'app', 'src', 'main', 'res'),
    path.join(projDir, 'app', 'res'),
  );
  log('Java 文件 ' + javaCopied + ' 个，资源文件 ' + resCopied + ' 个');

  patchManifest(projDir);
  patchAppActivity(projDir);
  log('完成。请在 Android Studio 或 gradlew assembleRelease 打包。');
}

main();
