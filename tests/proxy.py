import json, hmac, hashlib, base64, time, urllib.request, urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
SECRET=b'forvet-test-jwt-secret-0123456789abcdef'
USERS={'admin@forvet.test':('11111111-1111-1111-1111-111111111111','adminpass'),'viewer@forvet.test':('22222222-2222-2222-2222-222222222222','viewerpass')}
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def jwt(p): h=b64(json.dumps({'alg':'HS256','typ':'JWT'}).encode()); b=b64(json.dumps(p).encode()); s=b64(hmac.new(SECRET,f'{h}.{b}'.encode(),hashlib.sha256).digest()); return f'{h}.{b}.{s}'
def decode(t):
    try: return json.loads(base64.urlsafe_b64decode(t.split('.')[1]+'=='))
    except Exception: return {}
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def cors(self):
        self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Headers','*'); self.send_header('Access-Control-Allow-Methods','GET,POST,PATCH,PUT,DELETE,OPTIONS'); self.send_header('Access-Control-Expose-Headers','*')
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def body(self): n=int(self.headers.get('Content-Length') or 0); return self.rfile.read(n) if n else b''
    def j(self,code,obj):
        d=json.dumps(obj).encode(); self.send_response(code); self.cors(); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(d))); self.end_headers(); self.wfile.write(d)
    def user(self,email,uid): return {'id':uid,'aud':'authenticated','role':'authenticated','email':email,'app_metadata':{},'user_metadata':{},'created_at':'2026-01-01T00:00:00Z'}
    def auth(self):
        p=self.path
        if p.startswith('/auth/v1/token'):
            d=json.loads(self.body() or b'{}')
            if 'refresh_token' in d:
                email=d['refresh_token'].split(':',1)[1]; uid=USERS[email][0]
            else:
                u=USERS.get(d.get('email'))
                if not u or u[1]!=d.get('password'): return self.j(400,{'error':'invalid_grant','error_description':'Invalid login credentials','msg':'Invalid login credentials'})
                email=d['email']; uid=u[0]
            exp=int(time.time())+3600
            return self.j(200,{'access_token':jwt({'sub':uid,'role':'authenticated','email':email,'exp':exp,'aud':'authenticated'}),'token_type':'bearer','expires_in':3600,'expires_at':exp,'refresh_token':'r:'+email,'user':self.user(email,uid)})
        if p.startswith('/auth/v1/user'):
            c=decode(self.headers.get('Authorization','').split(' ')[-1]); 
            if c.get('role')!='authenticated': return self.j(401,{'msg':'no user'})
            return self.j(200,self.user(c['email'],c['sub']))
        if p.startswith('/auth/v1/logout'): self.send_response(204); self.cors(); self.end_headers(); return
        return self.j(404,{'msg':'nope'})
    def rest(self,method):
        path=self.path[len('/rest/v1'):]; data=self.body() if method in('POST','PATCH','PUT','DELETE') else None
        req=urllib.request.Request('http://127.0.0.1:3001'+path,data=data,method=method)
        for k,v in self.headers.items():
            if k.lower() not in('host','content-length','connection','accept-encoding'): req.add_header(k,v)
        try: r=urllib.request.urlopen(req); code=r.status; out=r.read(); hdrs=r.headers
        except urllib.error.HTTPError as e: code=e.code; out=e.read(); hdrs=e.headers
        self.send_response(code); self.cors()
        for k in('Content-Type','Content-Range','Preference-Applied'):
            if hdrs.get(k): self.send_header(k,hdrs.get(k))
        self.send_header('Content-Length',str(len(out))); self.end_headers(); self.wfile.write(out)
    def route(self,m):
        if self.path.startswith('/auth/v1'): return self.auth()
        if self.path.startswith('/rest/v1'): return self.rest(m)
        self.j(404,{})
    def do_GET(self): self.route('GET')
    def do_POST(self): self.route('POST')
    def do_PATCH(self): self.route('PATCH')
    def do_DELETE(self): self.route('DELETE')
    def do_HEAD(self): self.route('HEAD')
ThreadingHTTPServer(('127.0.0.1',54321),H).serve_forever()
