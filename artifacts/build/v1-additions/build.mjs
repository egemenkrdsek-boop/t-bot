import fs from 'node:fs/promises';
import path from 'node:path';
import { Presentation, PresentationFile } from '@oai/artifact-tool';
const root='C:/Users/Egemen/Desktop/T Bot';
const build=path.join(root,'artifacts/build/v1-additions');
const out=path.join(root,'artifacts/output/V1 Son Ekleneler.pptx');
await fs.mkdir(build,{recursive:true}); await fs.mkdir(path.dirname(out),{recursive:true});
const deck=Presentation.create({slideSize:{width:1280,height:720}});
const C={bg:'#F7FAF3',dark:'#172317',green:'#42710D',lime:'#78B82A',muted:'#526454',line:'#C5D3BA',white:'#FFFFFF',deep:'#14231F'};
const logoBytes=await fs.readFile(path.join(root,'artifacts/build/brand/tabt_logo.png'));
const logo=logoBytes.buffer.slice(logoBytes.byteOffset,logoBytes.byteOffset+logoBytes.byteLength);
function text(s,v,x,y,w,h,size=26,color=C.dark,bold=false,align='left'){const a=s.shapes.add({name:'editable-text',geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{style:'solid',fill:'none',width:0}});a.text=v;a.text.style={typeface:'Arial',fontSize:size,color,bold,alignment:align,verticalAlignment:'middle',wrap:'square',autoFit:'shrinkText',insets:0};return a;}
function rect(s,x,y,w,h,fill){return s.shapes.add({name:'background-or-rule',geometry:'rect',position:{left:x,top:y,width:w,height:h},fill,line:{style:'solid',fill:'none',width:0}})}
function base(title,n){const s=deck.slides.add();s.background.fill=C.bg;text(s,'T BOT  /  V1',65,35,400,24,16,C.green,true);text(s,title,65,78,1150,86,43,C.dark,true);rect(s,65,174,1150,2,C.line);text(s,String(n).padStart(2,'0'),1150,668,65,25,16,C.muted,true,'right');return s;}
function note(s,t,src){s.speakerNotes.text=`${t}\n\nKaynak: ${src}`;}
function row(s,y,label,copy){text(s,label,78,y,290,42,25,C.green,true);text(s,copy,382,y,795,63,24,C.dark);rect(s,78,y+68,1090,1,C.line);}
{
 const s=deck.slides.add(); s.background.fill=C.deep;
 s.images.add({blob:logo,contentType:'image/png',alt:'TABİT marka logosu',fit:'contain',position:{left:72,top:48,width:188,height:68}});
 text(s,'T Bot',74,210,1000,100,78,C.white,true);text(s,'V1 · Son Ekleneler',78,326,1070,62,40,'#DCEBD8',true);
 rect(s,78,420,150,5,C.lime);text(s,'Model kontrolü · Yerleşik beceriler · MCP bağlantıları',78,464,1050,48,27,'#DCEBD8');text(s,'Güncel ürün özelliklerinin kısa özeti',78,625,1000,32,20,'#B8C9B3');
 note(s,'T Bot V1 son eklemelerinin kısa özeti. Özellik açıklamaları güncel README ve uygulama kaynaklarına dayanır.','README.md; src/app.ts; src/skills.ts; src/mcp-presets.ts');
}
{
 const s=base('Model düşünme düzeyi ve Ultracode',2);
 text(s,'EFFORT',78,216,300,32,18,C.green,true);text(s,'Low  ·  Medium  ·  High  ·  XHigh  ·  Max',78,262,1110,60,35,C.dark,true);
 text(s,'Düzey, sağlayıcı ve model bazında saklanır. Model desteklemediğinde T Bot uygun düzeyi kullanır veya sağlayıcının varsayılanına döner.',78,340,1095,102,25,C.dark);
 rect(s,78,477,4,101,C.lime);text(s,'ULTRACODE',103,477,310,34,18,C.green,true);text(s,'İsteğe bağlı, oturumluk kod iş akışı',103,518,1040,45,29,C.dark,true);text(s,'Araştırma ve plan → ana ajan uygular → bağımsız kod incelemesi',103,568,1080,48,23,C.muted);
 note(s,'Effort düzeyi menüden veya --effort ile seçilir. Model yeteneği farklılık gösterebilir; desteklenmeyen düzeyin eşlenmesi kullanıcıya bildirilir. Ultracode oturum başına açılır ve kod incelemesi salt okunur yürütülür.','src/effort.ts; src/config.ts; src/app.ts; src/ultracode.ts');
}
{
 const s=base('Anahtar kelimeyle çağrılan beceriler',3);text(s,'İsteği yazın; eşleşen beceri yönergesi otomatik devreye girsin.',78,208,1100,52,28,C.dark,true);
 row(s,292,'/frontenddesign','Mevcut teknoloji yığınıyla çalışan, duyarlı gerçek arayüz kodu üretir.');row(s,382,'/backend','Sunucu ve API davranışını proje mimarisine uygun geliştirir.');row(s,472,'/codereview · /debuganalysis','Kod incelemesi ve hata nedenini analiz eder; salt okunur çalışır.');row(s,562,'/imagegen','İsteğe bağlı görsel varlığı üretir; arayüzün yerine görsel sunmaz.');
 note(s,'Beceri komutları yanında Türkçe ve İngilizce anahtar kelimeler de tanınır. Frontend tasarımı çıktısı çalışan UI kodudur; imagegen ayrı raster üretim aracıdır.','src/skills.ts; src/tools/image.ts; README.md');
}
{
 const s=base('Vercel, Supabase ve GitHub MCP',4);text(s,'Hesap tokenını /mcp menüsünden bağlayın. Kullanılabilir araçlar izinlere göre değişir.',78,208,1100,72,27,C.dark,true);
 row(s,305,'Vercel','Proje ve deployment oluşturma; üretim hedefi açıkça seçilir.');row(s,397,'Supabase','Proje oluşturma ve Edge Function dağıtımı dahil sunucu araçları.');row(s,489,'GitHub','Depo oluşturma, dosya gönderme ve pull request araçları.');
 text(s,'Her araç çağrısı normalde onay ister; YOLO açıkken otomatik onaylanır.',78,600,1100,42,22,C.muted);
 note(s,'Vercel bağlantısı Vercel API tokenı kullanan T Bot yerel MCP adaptörüdür; resmi hosted OAuth MCP değildir. Supabase resmi uzak MCP ve PAT kullanır. GitHub resmi uzak MCP ve PAT kullanır. Kullanım token ve hesap yetkilerine bağlıdır. Gerçek servis bağlantısı veya dağıtım denenmedi.','src/mcp-presets.ts; src/mcp-vercel.ts; README.md');
}
{
 const s=base('Kısa kullanım akışı',5);
 text(s,'1',78,226,72,60,40,C.lime,true);text(s,'/effort',155,226,235,50,30,C.green,true);text(s,'Model için düşünme düzeyini seçin.',410,226,745,52,25,C.dark);
 text(s,'2',78,326,72,60,40,C.lime,true);text(s,'/ultracode on',155,326,300,50,30,C.green,true);text(s,'Kod işinde çok aşamalı akışı açın.',480,326,675,52,25,C.dark);
 text(s,'3',78,426,72,60,40,C.lime,true);text(s,'/mcp',155,426,235,50,30,C.green,true);text(s,'Hesap bağlantılarını ve araçları yönetin.',410,426,745,52,25,C.dark);
 rect(s,78,548,4,73,C.lime);text(s,'Bağlantı, model erişimi ve yazma yetkileri seçilen hesap ve token kapsamına bağlıdır.',101,550,1060,72,23,C.muted);
 note(s,'Komut adları kullanıcıya dönük kısa başlangıç noktalarıdır. Tüm işlemler için --help ve /help kullanılabilir. Canlı model veya bulut servisi doğrulaması bu sunum çalışması kapsamında yapılmadı.','README.md; src/app.ts; docs/install.md');
}
const draft=path.join(build,'draft.pptx');await (await PresentationFile.exportPptx(deck)).save(draft);console.log(JSON.stringify({draft,out,slides:deck.slides.items.length}));
