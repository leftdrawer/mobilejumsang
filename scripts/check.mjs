#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let errors = 0;

function error(msg) {
  console.error(`❌ ${msg}`);
  errors++;
}

function success(msg) {
  console.log(`✅ ${msg}`);
}

console.log('=== 휴대점상 (mobilejumsang) 무결성 검증 ===\n');

// 1. manifest.webmanifest 검증
const manifestPath = join(root, 'manifest.webmanifest');
if (!existsSync(manifestPath)) {
  error('manifest.webmanifest 파일이 없습니다.');
} else {
  try {
    const raw = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    if (!manifest.name || !manifest.short_name) {
      error('manifest.webmanifest에 name 또는 short_name이 누락되었습니다.');
    } else {
      success(`manifest: "${manifest.name}" (${manifest.short_name}) 파싱 성공`);
    }

    if (Array.isArray(manifest.icons)) {
      for (const icon of manifest.icons) {
        const iconPath = join(root, icon.src);
        if (!existsSync(iconPath)) {
          error(`manifest 아이콘 누락: ${icon.src}`);
        } else {
          const size = statSync(iconPath).size;
          if (size === 0) {
            error(`manifest 아이콘 빈 파일: ${icon.src}`);
          }
        }
      }
      success(`manifest 아이콘 ${manifest.icons.length}개 파일 존재 확인`);
    } else {
      error('manifest.webmanifest에 icons 배열이 없습니다.');
    }
  } catch (e) {
    error(`manifest.webmanifest JSON 파싱 오류: ${e.message}`);
  }
}

// 2. sw.js 구문 및 유효성 검증
const swPath = join(root, 'sw.js');
if (!existsSync(swPath)) {
  error('sw.js 파일이 없습니다.');
} else {
  try {
    const swCode = readFileSync(swPath, 'utf8');
    new vm.Script(swCode);
    success('sw.js 구문 검증 통과 (JavaScript Syntax OK)');
  } catch (e) {
    error(`sw.js 구문 오류: ${e.message}`);
  }
}

// 3. index.html 무결성 및 핵심 DOM ID 검증
const htmlPath = join(root, 'index.html');
if (!existsSync(htmlPath)) {
  error('index.html 파일이 없습니다.');
} else {
  const html = readFileSync(htmlPath, 'utf8');
  if (html.length < 1000) {
    error('index.html 파일 내용이 너무 작습니다.');
  } else {
    success(`index.html 파일 로드 성공 (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
  }

  if (!html.includes('휴대점상')) {
    error('index.html에 "휴대점상" 타이틀/텍스트가 없습니다.');
  }

  if (!html.includes('serviceWorker.register')) {
    error('index.html에 서비스워커 등록 로직이 누락되었습니다.');
  }

  const criticalIds = ['gl', 'app', 'ui', 'loading', 'err'];
  const presentIds = new Set(Array.from(html.matchAll(/\sid=["']([^"']+)["']/g)).map(m => m[1]));
  const missingIds = criticalIds.filter(id => !presentIds.has(id));

  if (missingIds.length > 0) {
    error(`index.html 핵심 DOM ID 누락: ${missingIds.join(', ')}`);
  } else {
    success(`핵심 DOM ID (${criticalIds.join(', ')}) 모두 존재 확인`);
  }
}

console.log('\n----------------------------------------');
if (errors > 0) {
  console.error(`검증 실패: 총 ${errors}개 오류 발견`);
  process.exit(1);
} else {
  console.log('✨ 모든 무결성 검증을 통과했습니다!');
  process.exit(0);
}
