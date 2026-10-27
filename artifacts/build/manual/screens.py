from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
D=Path('artifacts/build/screens'); D.mkdir(parents=True,exist_ok=True)
f='C:/Windows/Fonts/consola.ttf'; b='C:/Windows/Fonts/consolab.ttf'; font=ImageFont.truetype(f,28); title=ImageFont.truetype(b,25); small=ImageFont.truetype(b,21)
cases={
'setup':['T BOT   /   BAŞLANGIÇ','Sağlayıcı seçin','  Gemini','  OpenAI','  Anthropic','> OpenRouter','↑ ↓ seç  •  Enter onayla  •  Esc iptal'],
'plan':['T BOT   /   OTURUM','> /plan Bu projeyi incele ve düzenleme planı hazırla','Plan hazır. İnceleyin; uygulamak için /plan apply yazın.','','> /plan apply','Araç onayı gerektiğinde yanıtınızı girin.'],
'subagents':['T BOT   /   ARAŞTIRMA','> /subagents Projenin yapısını incele','Alt ajan modeli seçin','> Model seçeneği','','Araştırmalar salt okunur; ana ajan sonucu değerlendirir.'],
'yolo':['T BOT   /   ONAY MODU','> /yolo on','Oturumda araç onayları otomatik verilir.','','> /yolo off','Araç onayları yeniden istenir.']}
for name,lines in cases.items():
 im=Image.new('RGB',(1400,750),'#0b1720'); d=ImageDraw.Draw(im); d.rounded_rectangle((18,18,1382,732),25,fill='#122631',outline='#3c5554',width=2); d.rounded_rectangle((18,18,1382,90),25,fill='#1b3540'); d.rectangle((18,55,1382,90),fill='#1b3540');
 for i,c in enumerate(['#ff7b78','#f9c96b','#62d49a']): d.ellipse((48+i*31,43,62+i*31,57),fill=c)
 d.text((163,38),'T BOT  •  TERMİNAL',font=small,fill='#d6e7df'); d.text((1090,38),'TEMSİLİ EKRAN',font=small,fill='#7ce4ac')
 for i,line in enumerate(lines): d.text((65,125+i*73),line,font=title if i==0 else font,fill='#72e3a6' if i==0 or line.startswith('>') else '#e3eee9')
 im.save(D/(name+'.png'))
