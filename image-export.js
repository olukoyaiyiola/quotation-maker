'use strict';

// Lay out the same client document at a fixed A4 width, independent of phone zoom.
async function renderExportPage(record) {
  const sheet=document.createElement('article');
  sheet.className='paper export-sheet';
  Object.assign(sheet.style,{position:'absolute',left:'-10000px',top:'0',width:'794px',maxWidth:'none',
    padding:'40px',boxSizing:'border-box',minHeight:'0',border:'0',borderRadius:'0',boxShadow:'none',background:'white'});
  sheet.innerHTML=quotationHTML(record.quote,record.profile,record.systemName);
  document.body.append(sheet);

  try{
    await document.fonts.ready;
    await Promise.all(Array.from(sheet.querySelectorAll('img'), img => img.decode()));
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
    const width=2480, height=3508;
    const scale=Math.min(width/base.width,height/base.height);
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='white';ctx.fillRect(0,0,width,height);
    ctx.translate((width-base.width*scale)/2,0);
    ctx.scale(scale,scale);
      for(const b of backgrounds){ctx.fillStyle=b.color;ctx.fillRect(b.x,b.y,b.w,b.h)}
      for(const o of ink){

        if(o.img){ctx.drawImage(o.img,o.x,o.y,o.w,o.h);continue}
        ctx.font=o.font;ctx.fillStyle=o.color;ctx.textBaseline='alphabetic';
        const metric=ctx.measureText('Mg');
        const ascent=metric.fontBoundingBoxAscent,descent=metric.fontBoundingBoxDescent;
        ctx.fillText(o.str,o.x,o.y+(o.h+ascent-descent)/2);
      }
    return canvas;
  } finally { sheet.remove(); }
}

function canvasBlob(canvas,type) {
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not generate the image.')),type,0.96));
}

// Embed the fitted page as one JPEG in a single-page A4 PDF.
async function onePagePdf(jpeg,width,height) {
  const encoder=new TextEncoder(), chunks=[], offsets=[0];
  let size=0;
  function append(data) {
    const bytes=typeof data==='string'?encoder.encode(data):data;
    chunks.push(bytes);size+=bytes.length;
  }
  function object(number,body) {
    offsets[number]=size;
    append(number+' 0 obj\n');append(body);append('\nendobj\n');
  }
  append('%PDF-1.4\n');
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  object(2,'<< /Type /Pages /Count 1 /Kids [3 0 R] >>');
  object(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /PageImage 4 0 R >> >> /Contents 5 0 R >>');
  offsets[4]=size;
  append('4 0 obj\n<< /Type /XObject /Subtype /Image /Width '+width+' /Height '+height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.size+' >>\nstream\n');
  append(new Uint8Array(await jpeg.arrayBuffer()));append('\nendstream\nendobj\n');
  const draw='q 595.28 0 0 841.89 0 0 cm /PageImage Do Q';
  object(5,'<< /Length '+draw.length+' >>\nstream\n'+draw+'\nendstream');
  const xref=size;
  append('xref\n0 6\n0000000000 65535 f \n');
  for(const offset of offsets.slice(1))append(String(offset).padStart(10,'0')+' 00000 n \n');
  append('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');
  return new Blob(chunks,{type:'application/pdf'});
}
