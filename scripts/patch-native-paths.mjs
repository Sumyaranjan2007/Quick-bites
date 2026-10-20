#!/usr/bin/env node
/**
 * Windows 260-character path limit, react-native-keyboard-controller (round 3, build 40).
 *
 * Its C++ sources sit outside its CMakeLists folder, so CMake mirrors their full
 * absolute path under the build folder: 347 characters from D:\qbx, and ninja fails
 * ("Filename longer than 260 characters"). This makes CMake compile COPIES of those
 * files placed inside the build folder (about 230 characters). Same code, same flags.
 *
 * Idempotent; run by scripts/build-apks.sh after node_modules is installed.
 * seniordev: a text patch of one library file; drop it when the library keeps its
 * sources under android/ or Windows long paths are enabled on the build machine.
 */
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('node_modules/react-native-keyboard-controller/android/src/main/jni/CMakeLists.txt');
const MARK = '# Quick Bites: short object paths';

if (!fs.existsSync(file)) {
  console.log('patch-native-paths: keyboard controller not installed, nothing to do');
  process.exit(0);
}
let text = fs.readFileSync(file, 'utf8');
if (text.includes(MARK)) {
  console.log('patch-native-paths: already patched');
  process.exit(0);
}

const globs = /file\(GLOB LIB_CODEGEN_SRCS[^\n]*\n/;
const addLib = /add_library\(\s*\$\{LIB_TARGET_NAME\}\s*SHARED\s*\$\{LIB_CUSTOM_SRCS\}\s*\$\{LIB_CODEGEN_SRCS\}\s*\)/;
const includes = /target_include_directories\(\s*\$\{LIB_TARGET_NAME\}\s*PUBLIC\s*\.\s*/;
if (!globs.test(text) || !addLib.test(text) || !includes.test(text)) {
  console.error('patch-native-paths: the library CMakeLists changed shape; update this script');
  process.exit(1);
}

text = text.replace(globs, match => `${match}
${MARK} (Windows 260-character limit): compile copies inside the build folder.
set(QB_SHORT_SRCS)
set(QB_INDEX 0)
foreach(src \${LIB_CUSTOM_SRCS} \${LIB_CODEGEN_SRCS})
  get_filename_component(name \${src} NAME)
  configure_file(\${src} \${CMAKE_CURRENT_BINARY_DIR}/s/\${QB_INDEX}/\${name} COPYONLY)
  list(APPEND QB_SHORT_SRCS \${CMAKE_CURRENT_BINARY_DIR}/s/\${QB_INDEX}/\${name})
  math(EXPR QB_INDEX "\${QB_INDEX} + 1")
endforeach()
`);
text = text.replace(addLib, 'add_library(\n  ${LIB_TARGET_NAME}\n  SHARED\n  ${QB_SHORT_SRCS}\n)');
// The copies no longer sit beside their headers: add those folders to the include path.
text = text.replace(includes, m => `${m}\${CMAKE_CURRENT_SOURCE_DIR}\n  \${LIB_COMMON_COMPONENTS_DIR}\n  \${LIB_ANDROID_GENERATED_COMPONENTS_DIR}\n  `);
fs.writeFileSync(file, text);
console.log('patch-native-paths: patched', file);
