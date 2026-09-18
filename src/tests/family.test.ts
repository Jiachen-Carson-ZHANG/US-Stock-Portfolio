import { beforeEach, expect, it } from 'vitest';
import { createTestDb, type DB } from '@/lib/db';
import { familyAction, readFamily } from '@/lib/family/repository';
const owner = {id:'o',displayName:'Owner',role:'owner' as const};
const viewer = {id:'v',displayName:'Viewer',role:'viewer' as const};
let db: DB;
const now = new Date('2026-09-18T12:00:00Z');
beforeEach(()=>{ db=createTestDb(); });
const act=(user:typeof owner|typeof viewer, action:Record<string,unknown>, date=now)=>familyAction(db,user,action,date);
it('preserves discussions, replies and reactions and enforces author deletion',()=>{
 act(owner,{action:'post',text:'Our thoughts',symbol:'AAPL'});
 const id=readFamily(db,viewer,now).posts[0].id;
 act(viewer,{action:'reply',id,text:'Why this company?'});
 act(viewer,{action:'react',id,reaction:'explain'});
 expect(readFamily(db,viewer,now).posts[0].replies).toHaveLength(1);
 expect(()=>act(viewer,{action:'deletePost',id})).toThrow();
 expect(readFamily(db,viewer,now).posts[0].unread).toBe(true);
 act(viewer,{action:'read'});
 expect(readFamily(db,viewer,now).posts[0].unread).toBe(false);
});
it('allows only one weekly vote per member and unique nominations',()=>{
 act(owner,{action:'nominate',symbol:'AAPL',text:'Products we use'});
 expect(()=>act(viewer,{action:'nominate',symbol:'AAPL',text:'Again'})).toThrow();
 const id=readFamily(db,viewer,now).nominations[0].id;
 act(viewer,{action:'vote',id});
 expect(()=>act(viewer,{action:'vote',id})).toThrow();
});
it('hides locked predictions including from their author, reveals at date',()=>{
 act(owner,{action:'predict',text:'Secret forecast',revealAt:'2026-09-20'});
 expect(JSON.stringify(readFamily(db,owner,now))).not.toContain('Secret forecast');
 expect(readFamily(db,viewer,new Date('2026-09-21')).predictions[0].text).toBe('Secret forecast');
 expect(()=>act(owner,{action:'predict',text:'Past',revealAt:'2026-09-17'})).toThrow();
});
it('keeps goal contributions in an independent ledger',()=>{
 act(owner,{action:'goal',text:'Holiday',target:1000});
 const id=readFamily(db,owner,now).goals[0].id;
 act(viewer,{action:'contribute',id,amount:25}); act(owner,{action:'contribute',id,amount:30});
 expect(readFamily(db,owner,now).goals[0].saved).toBe(55);
 expect(()=>act(viewer,{action:'contribute',id,amount:-2})).toThrow();
});
it('paper challenge is owner-created, equal funded and cannot overspend or sell absent shares',()=>{
 expect(()=>act(viewer,{action:'challenge',text:'Autumn',endsAt:'2026-10-18'})).toThrow();
 act(owner,{action:'challenge',text:'Autumn',endsAt:'2026-10-18'});
 act(viewer,{action:'join'}); act(owner,{action:'join'});
 const quote={price:100,source:'moomoo',dataTimestamp:now.toISOString()};
 familyAction(db,viewer,{action:'trade',symbol:'AAPL',side:'buy',quantity:10},now,quote);
 expect(readFamily(db,viewer,now).challenge?.members.find(m=>m.userId==='v')?.cash).toBe(9000);
 expect(()=>familyAction(db,viewer,{action:'trade',symbol:'AAPL',side:'buy',quantity:1000},now,quote)).toThrow();
 expect(()=>familyAction(db,viewer,{action:'trade',symbol:'AAPL',side:'sell',quantity:11},now,quote)).toThrow();
 expect(()=>familyAction(db,viewer,{action:'trade',symbol:'AAPL',side:'buy',quantity:1},new Date('2026-11-01'),quote)).toThrow();
 expect(()=>act(viewer,{action:'trade',symbol:'AAPL',side:'buy',quantity:1,price:1})).toThrow();
});
