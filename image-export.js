'use strict';

// Lay out the same client document at a fixed A4 width, independent of phone zoom.
async function showImages(record) {
  const sheet=document.createElement('article');
  sheet.className='paper';
  Object.assign(sheet.style,{position:'absolute',left:'-10000px',top:'0',width:'794px',maxWidth:'none',
    padding:'40px',boxSizing:'border-box',minHeight:'0',border:'0',borderRadius:'0',boxShadow:'none',background:'white'});
  sheet.innerHTML=quotationHTML(record.quote,record.profile,record.systemName);
  document.body.append(sheet);
  const urls=[];
  try{
    await document.fonts.ready;
    await Promise.all(Array.from(sheet.images,img=>img.decode()));
    const base=sheet.getBoundingClientRect(),ink=[],backgrounds=[];
    const area=r=>({x:r.left-base.left,y:r.top-base.top,w:r.width,h:r.height});
    for(const el of sheet.querySelectorAll('*')){
      const style=getComputedStyle(el),box=area(el.getBoundingClientRect());
      if(style.backgroundColor!=='rgba(0, 0, 0, 0)')backgrounds.push({...box,color:style.backgroundColor});
      const border=parseFloat(style.borderBottomWidth);
      if(border)backgrounds.push({x:box.x,y:box.y+box.h-border,w:box.w,h:border,color:style.borderBottomColor});
      if(el instanceof HTMLImageElement){ink.push({...box,img:el});continue}
      for(const node of el.childNodes){
        if(node.nodeType!==Node.TEXT_NODE)continue;
        const range=document.createRange();
        const pattern=/\S+/gu;
        for(const token of node.textContent.matchAll(pattern)){
          let start=token.index,end=start+token[0].length;
          range.setStart(node,start);range.setEnd(node,end);
          const rects=range.getClientRects();
          const addText=(str,r)=>ink.push({...area(r),str,color:style.color,font:style.fontWeight+' '+style.fontSize+' '+style.fontFamily});
          if(rects.length===1){addText(style.textTransform==='uppercase'?token[0].toUpperCase():token[0],rects[0]);continue}
          // Extremely long unbroken descriptions can wrap within one word.
          for(const char of token[0]){
            range.setStart(node,start);start+=char.length;range.setEnd(node,start);
            addText(char,range.getBoundingClientRect());
          }
        }
      }
    }
    const width=2480,height=3508,scale=width/794,usable=height/scale-80;
    const pageHeight=height/scale;
    let offset=0,page=1;
    while(offset<base.height){
      let end=Math.min(base.height,offset+usable);
      if(end<base.height){
        // Break between lines so no signature or row of text is sliced.
        for(;;){
          const cross=ink.filter(o=>o.y<end && o.y+o.h>end+0.01);
          if(!cross.length)break;
          const earlier=Math.min(...cross.map(o=>o.y));
          if(earlier<=offset+1)break;
          end=earlier;
        }
      }
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d');
      ctx.scale(scale,scale);ctx.fillStyle='white';ctx.fillRect(0,0,794,pageHeight);
      ctx.save();ctx.translate(0,32-offset);
      ctx.beginPath();ctx.rect(0,offset,794,end-offset);ctx.clip();
      for(const b of backgrounds){ctx.fillStyle=b.color;ctx.fillRect(b.x,b.y,b.w,b.h)}
      for(const o of ink){
        if(o.y>=end || o.y+o.h<=offset)continue;
        if(o.img){ctx.drawImage(o.img,o.x,o.y,o.w,o.h);continue}
        ctx.font=o.font;ctx.fillStyle=o.color;ctx.textBaseline='alphabetic';
        const metric=ctx.measureText('Mg');
        const ascent=metric.fontBoundingBoxAscent,descent=metric.fontBoundingBoxDescent;
        ctx.fillText(o.str,o.x,o.y+(o.h+ascent-descent)/2);
      }
      ctx.restore();ctx.fillStyle='#526782';ctx.font='12px sans-serif';
      ctx.fillText(record.ref+'   ·   Page '+page,40,pageHeight-20);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob)throw Error('Image generation failed.');
      urls.push(URL.createObjectURL(blob));canvas.width=canvas.height=1;
      page++;offset=end;
    }
    const dialog=byId('images');
    byId('downloads').replaceChildren(...urls.map((url,index)=>{
      const a=document.createElement('a');a.className='record';a.href=url;
      a.download=record.ref.replaceAll('/','-')+(urls.length>1?'-p'+(index+1):'')+'.png';
      a.textContent=urls.length>1?'Download page '+(index+1)+' of '+urls.length:'Download quotation PNG';
      return a;
    }));
    dialog.addEventListener('close',()=>urls.forEach(url=>URL.revokeObjectURL(url)),{once:true});
    dialog.showModal();
  }catch(e){urls.forEach(url=>URL.revokeObjectURL(url));throw e}
  finally{sheet.remove()}
}
