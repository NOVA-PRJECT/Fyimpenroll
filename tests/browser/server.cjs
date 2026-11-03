const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const webpack = require('webpack')
const output = path.resolve('scratch/browser-fixture')
const config = { mode:'development',devtool:false,entry:path.resolve('tests/browser/fixture.tsx'),output:{path:output,filename:'fixture.js'},
  resolve:{extensions:['.tsx','.ts','.js','.cjs'],alias:{'@':path.resolve('frontend/src'),'next/navigation':path.resolve('tests/browser/navigation.ts')}},
  module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.resolve('tests/browser/transpile-loader.cjs')}]}}
webpack(config,(error,stats)=>{
  if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1;return}
  const held=[],counts={A:0,B:0};let holdA=false,holdRefresh=false,holdSession=false
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'),account=/identity=([AB])/.exec(req.headers.cookie||'')?.[1]
    const json=(value,status=200)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))}}
    if(url.pathname==='/fixture.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fs.readFileSync(path.join(output,'fixture.js')));return}
    if(url.pathname==='/test/hold'){holdA=true;json({success:true});return}
    if(url.pathname==='/test/hold-refresh'){holdRefresh=true;json({success:true});return}
    if(url.pathname==='/test/hold-session'){holdSession=true;json({success:true});return}
    if(url.pathname==='/test/release'){holdA=false;holdRefresh=false;holdSession=false;held.splice(0).forEach(send=>send());json({success:true});return}
    if(url.pathname==='/test/counts'){json(counts);return}
    if(url.pathname==='/api/auth/login'){
      res.setHeader('Set-Cookie','identity=B; HttpOnly; Path=/; SameSite=Lax');json({success:true});return
    }
    if(url.pathname==='/api/auth/logout'){
      res.setHeader('Set-Cookie','identity=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');json({success:true});return
    }
    if(url.pathname==='/api/auth/refresh'){
      if(!account){json({code:'AUTH_SESSION_REJECTED'},401);return}
      const send=()=>{if(!res.destroyed){res.setHeader('Set-Cookie',`identity=${account}; HttpOnly; Path=/`);json({success:true})}}
      if(holdRefresh)held.push(send);else send();return
    }
    if(url.pathname==='/api/auth/session'){
      const send=()=>json(account?{dataScope:'verified-session-'+account}:{code:'AUTH_SESSION_REJECTED'},account?200:401)
      if(holdSession)held.push(send);else send();return
    }
    if(url.pathname==='/api/hod/students'){
      if(!account){json({code:'AUTH_SESSION_REJECTED'},401);return}
      counts[account]++
      const send=()=>{if(!res.destroyed){res.setHeader('X-Data-Scope','verified-session-'+account);json({name:'Private account '+account})}}
      if(holdA&&account==='A')held.push(send);else send();return
    }
    res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>')
  })
  server.listen(4178,'127.0.0.1')
  process.once('SIGTERM',()=>server.close())
})
