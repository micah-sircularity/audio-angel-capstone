import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, expect, it, vi } from "vitest";
const { request } = vi.hoisted(() => ({request:vi.fn()}));
vi.mock("node:https", () => ({request}));
import { proxyAuth } from "./auth-proxy";
beforeEach(()=>request.mockReset());
function fixture() {
  const req = Object.assign(new PassThrough(), {headers:{host:"preview.example:8452",authorization:"Bearer fixture",origin:"https://preview.example:8450","x-forwarded-host":"attacker.example"},url:"/api/auth/callback/spotify?code=fixture",method:"GET"});
  const res = Object.assign(new PassThrough(),{writeHead:vi.fn(),headersSent:false});
  return {req,res};
}
it("rejects arbitrary upstream hosts before forwarding credentials",()=>{
  const {req,res}=fixture();
  proxyAuth(req as unknown as IncomingMessage,res as unknown as ServerResponse,"https://attacker.example");
  expect(request).not.toHaveBeenCalled();
  expect(res.writeHead.mock.calls[0][0]).toBe(503);
});
it("uses the Convex host, keeps session headers, strips spoofed forwarding and preserves redirects/cookies",()=>{
  const outgoing=Object.assign(new PassThrough(),{setTimeout:vi.fn()});
  request.mockReturnValue(outgoing);
  const {req,res}=fixture();
  proxyAuth(req as unknown as IncomingMessage,res as unknown as ServerResponse,"https://your-deployment.convex.site");
  const [options,onResponse]=request.mock.calls[0];
  expect(options).toMatchObject({hostname:"your-deployment.convex.site",path:req.url,method:"GET",headers:{host:"your-deployment.convex.site",authorization:"Bearer fixture",origin:"https://preview.example:8450"}});
  expect(options.headers["x-forwarded-host"]).toBeUndefined();
  const response=Object.assign(new PassThrough(),{statusCode:302,headers:{location:"https://preview.example/library","set-cookie":["first=fixture; Secure","second=fixture; Secure"]}});
  onResponse(response);
  expect(res.writeHead).toHaveBeenCalledWith(302,{...response.headers,"cache-control":"no-store"});
  response.end(); req.end();
});
