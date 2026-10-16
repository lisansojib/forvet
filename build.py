"""Build dist/index.html (single file) from src/. Run: python build.py"""
import subprocess, pathlib, shutil
root = pathlib.Path(__file__).resolve().parent
(root/'build').mkdir(exist_ok=True); (root/'dist').mkdir(exist_ok=True)
subprocess.run(['npx','tailwindcss','-c','tailwind.config.js','-i','src/tw.css','-o','build/tw.css','--minify'], cwd=root, check=True, capture_output=True)
css = (root/'build/tw.css').read_text()
js = '\n'.join((root/f'src/app{i}.js').read_text() for i in range(1,5))
(root/'build/app.js').write_text(js)
head = (root/'src/head.html').read_text().replace('/*__TAILWIND__*/', css)
html = head + (root/'src/body.html').read_text() + (root/'src/modals.html').read_text() + '\n  <script>\n' + js + '\n  </script>\n</body>\n</html>\n'
assert '</script' not in js.replace('<\\/script','')
(root/'dist/index.html').write_text(html)
shutil.copy(root/'config.js', root/'dist/config.js')
for f in (root/'static').glob('*'):
    shutil.copy(f, root/'dist'/f.name)  # e.g. _headers for Cloudflare Pages
print('dist/index.html', len(html)//1024, 'KB; css', len(css)//1024, 'KB')
