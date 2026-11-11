from pathlib import Path
import base64,gzip,json
root=Path(__file__).resolve().parents[1]
css=next((root/'dist/assets').glob('*.css')).read_text()
js=next((root/'dist/assets').glob('*.js')).read_text().replace('import.meta.url', '"https://audio-angel.invalid/"')
font=base64.b64encode((root/'public/dm-sans.ttf').read_bytes()).decode()
css=css.replace('/dm-sans.ttf','data:font/ttf;base64,'+font)
html='<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Audio Angel walkthrough</title><style>'+css+'</style><div id="root"></div><script type="module">'+js.replace('</script','<\\/script')+'</script></html>'
(root/'audio-angel.html').write_text(html)
css+='\nbody{background:transparent;color:var(--foreground)}main{padding:0;width:100%}.host-intro{display:none}.host-footer{margin:16px auto;max-width:560px} .host-footer span{display:none}'
payload=base64.b64encode(gzip.compress(json.dumps({'css':css,'js':js}).encode())).decode()
(root/'inline-payload.txt').write_text(payload)
print('Standalone HTML packaged; compressed inline payload:',len(payload),'characters')
