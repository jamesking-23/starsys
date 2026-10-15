import { refreshIcons } from './icons.js';

        /* ---- classic glue (runs before module; provides shared helpers) ---- */
                (function(){
            var n = 0;
            var TXT = '\u2022 \u2022 \u2022 \u2022 STARSYS  FINANCIAL  REPORTING \u2022 \u2022 \u2022 \u2022 \u2022 \u2022';
            function sealSVG(id, side){
                var c = side ? 'var(--cthi)' : 'var(--ink)';
                var w1 = side ? '2.4' : '1.2', w2 = side ? '1.6' : '.9', w3 = side ? '2' : '1';
                var o1 = side ? '.55' : '.5', o2 = side ? '.4' : '.35', o3 = side ? '.35' : '.3', ot = side ? '.85' : '.8';
                return '<svg class="seal" viewBox="18 18 84 84" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Starsys Financial Reporting">'
                + '<defs><path id="wp'+id+'" d="M60,60 m0,27.5 a27.5,27.5 0 1,1 0,-55 a27.5,27.5 0 1,1 0,55"/></defs>'
                + '<g><animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="34s" repeatCount="indefinite"/>'
                + '<circle cx="60" cy="60" r="34" fill="none" stroke="'+c+'" stroke-opacity="'+o1+'" stroke-width="'+w1+'"/>'
                + '<circle cx="60" cy="60" r="25.5" fill="none" stroke="'+c+'" stroke-opacity="'+o2+'" stroke-width="'+w2+'"/>'
                + '<circle cx="60" cy="60" r="23" fill="none" stroke="'+c+'" stroke-opacity="'+o3+'" stroke-width="'+w3+'"/>'
                + '<text font-family="Archivo,sans-serif" font-weight="700" font-size="6.6" letter-spacing=".4" fill="'+c+'" fill-opacity="'+ot+'" xml:space="preserve">'
                + '<textPath href="#wp'+id+'">'+TXT+'</textPath></text></g>'
                + '<g><animateTransform attributeName="transform" type="rotate" from="0 60 60" to="-360 60 60" dur="11s" repeatCount="indefinite"/>'
                + '<path d="M60 60 C57.2 54.5 57.2 49 60 42 C62.8 49 62.8 54.5 60 60 Z" fill="var(--acc)"/><path d="M60 60 C57.2 54.5 57.2 49 60 42 C62.8 49 62.8 54.5 60 60 Z" transform="rotate(90 60 60)" fill="var(--acc)"/><path d="M60 60 C57.2 54.5 57.2 49 60 42 C62.8 49 62.8 54.5 60 60 Z" transform="rotate(180 60 60)" fill="var(--acc)"/><path d="M60 60 C57.2 54.5 57.2 49 60 42 C62.8 49 62.8 54.5 60 60 Z" transform="rotate(270 60 60)" fill="var(--acc)"/>'
                + '<circle cx="60" cy="60" r="2.2" fill="var(--accd)"/></g></svg>';
            }
            function injectLogos(){ document.querySelectorAll('.starsys-logo').forEach(function(el){ if(!el.firstChild) el.innerHTML = sealSVG(++n, el.dataset.variant==='side'); }); }
            if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', injectLogos); else injectLogos();
        })();
        (function(){
            function toggleSidebar(open){
                var sb=document.getElementById('sidebar'), bd=document.getElementById('sidebarBackdrop');
                if(!sb) return;
                if(open===undefined) open = !sb.classList.contains('open');
                sb.classList.toggle('open', open);
                if(bd) bd.classList.toggle('open', open);
            }
            document.addEventListener('DOMContentLoaded', function(){
                var st=document.getElementById('sidebarToggleBtn'); if(st) st.addEventListener('click', ()=>toggleSidebar());
                var bd=document.getElementById('sidebarBackdrop'); if(bd) bd.addEventListener('click', ()=>toggleSidebar(false));
                document.querySelectorAll('.js-theme-toggle').forEach(b=> b.addEventListener('click', ()=>{
                    var dark = !document.documentElement.classList.contains('dark');
                    document.documentElement.classList.toggle('dark', dark);
                    try{ localStorage.setItem('theme', dark?'dark':'light'); }catch(e){}
                    var meta=document.querySelector('meta[name="theme-color"]'); if(meta) meta.setAttribute('content', dark?'#000000':'#faf8f3');
                }));
                (function(){
                    var sl=document.getElementById('fontSizeSlider'), val=document.getElementById('fontSizeValue'), rs=document.getElementById('fontSizeReset');
                    if(!sl) return;
                    function applyScale(v, persist){
                        v=Math.max(100, Math.min(120, parseInt(v,10)||100));
                        document.documentElement.style.fontSize = v===100 ? '' : v+'%';
                        sl.value=v; val.textContent=v+'%'; sl.setAttribute('aria-valuetext', v+' percent');
                        if(persist){ try{ if(v===100) localStorage.removeItem('fontScale'); else localStorage.setItem('fontScale', String(v)); }catch(e){} }
                    }
                    var saved=100; try{ saved=parseInt(localStorage.getItem('fontScale'),10)||100; }catch(e){}
                    applyScale(saved,false);
                    sl.addEventListener('input', function(){ applyScale(sl.value,true); });
                    rs.addEventListener('click', function(){ applyScale(100,true); });
                })();
                refreshIcons();
            });
        })();
