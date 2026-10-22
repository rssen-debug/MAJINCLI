/* MAJIN spoken correction classifier. Strict commands avoid cancelling by accident. */
(function(){
'use strict';
function classify(input,busy){
 const raw=String(input||'').trim();
 const s=raw.toLocaleLowerCase('sv-SE').replace(/[!?.,]+/g,' ').replace(/\s+/g,' ').trim();
 if(!raw)return {kind:'empty',text:''};
 const interrupt=/^(?:nej(?: vänta| stopp)?|vänta|stopp|stop|avbryt|cancel|hold on|wait|never mind|stop that)$/;
 if(interrupt.test(s))return {kind:'cancel',text:''};
 // Strip conversational interjections only when immediately followed by
 // a clear replacement action, never from an ordinary mention of "nej".
 const prefix=/^(?:(?:nej[!,.]?\s*)?(?:vänta[!,.]?\s*)?|istället[!,.]?\s*|wait[!,.]?\s*)/i;
 const action=/^(?:gör|öppna|sök|visa|skapa|bygg|hitta|gå till|open|search|show|create|build)\b/i;
 const remaining=raw.replace(prefix,'').trim();
 const wasCorrection=remaining!==raw && action.test(remaining);
 if(busy && wasCorrection)return {kind:'replace',text:remaining};
 return {kind:'send',text:raw};
}
window.MAJIN_VOICE_INTENT={classify};
})();