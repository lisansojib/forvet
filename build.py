"""Build dist/index.html (single file) from src/. Run: python build.py"""
import subprocess, pathlib, shutil
root = pathlib.Path(__file__).resolve().parent
(root/'build').mkdir(exist_ok=True); (root/'dist').mkdir(exist_ok=True)
npx = shutil.which('npx') or 'npx'  # on Windows this resolves to npx.cmd
subprocess.run([npx,'tailwindcss','-c','tailwind.config.js','-i','src/tw.css','-o','build/tw.css','--minify'], cwd=root, check=True, capture_output=True)
css = (root/'build/tw.css').read_text(encoding='utf-8')
js = '\n'.join((root/f'src/app{i}.js').read_text(encoding='utf-8') for i in range(1,6))
(root/'build/app.js').write_text(js, encoding='utf-8')
head = (root/'src/head.html').read_text(encoding='utf-8').replace('/*__TAILWIND__*/', css)
html = head + (root/'src/body.html').read_text(encoding='utf-8') + (root/'src/modals.html').read_text(encoding='utf-8') + '\n  <script>\n' + js + '\n  </script>\n</body>\n</html>\n'
assert '</script' not in js.replace('<\\/script','')
(root/'dist/index.html').write_text(html, encoding='utf-8')
shutil.copy(root/'config.js', root/'dist/config.js')
for f in (root/'static').glob('*'):
    shutil.copy(f, root/'dist'/f.name)  # e.g. _headers for Cloudflare Pages
print('dist/index.html', len(html)//1024, 'KB; css', len(css)//1024, 'KB')
