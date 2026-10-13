import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPyproject, readRequirements } from './pypi.ts';

test('reads pinned and ranged requirements, skipping everything else', () => {
  const text = [
    '# comment',
    'Django==5.1.2',
    'requests>=2.31,<3  # http',
    'pydantic[email]~=2.7',
    'flask',
    '-r base.txt',
    '--index-url https://example.org/simple',
    'git+https://github.com/a/b.git',
    'numpy==1.26.*',
    'Typing_Extensions===4.12.2 ; python_version < "3.11"',
  ].join('\n');
  assert.deepEqual(readRequirements(text), [
    { ecosystem: 'pypi', name: 'django', version: '5.1.2', pin: 'exact' },
    { ecosystem: 'pypi', name: 'requests', version: '2.31', pin: 'range' },
    { ecosystem: 'pypi', name: 'pydantic', version: '2.7', pin: 'range' },
    { ecosystem: 'pypi', name: 'numpy', version: '1.26', pin: 'range' },
    { ecosystem: 'pypi', name: 'typing-extensions', version: '4.12.2', pin: 'exact' },
  ]);
});

test('reads [project].dependencies from pyproject.toml only', () => {
  const text = `[build-system]
requires = ["hatchling>=1.25"]

[project]
name = "svc"
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn[standard]==0.32.0",
  'httpx',
]

[project.optional-dependencies]
dev = ["pytest==8.3.3"]
`;
  assert.deepEqual(readPyproject(text), [
    { ecosystem: 'pypi', name: 'fastapi', version: '0.115.0', pin: 'range' },
    { ecosystem: 'pypi', name: 'uvicorn', version: '0.32.0', pin: 'exact' },
  ]);
  assert.deepEqual(readPyproject('[tool.poetry]\nname = "x"\n'), []);
});
