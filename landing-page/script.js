// Legal Judgment AI Landing Page Interactive Script

document.addEventListener('DOMContentLoaded', () => {
  initLandingPage();
});

function initLandingPage() {
  // ==========================================
  // 1. Navigation & Floating Navbar Scroll Behavior
  // ==========================================
  const navbar = document.getElementById('main-navbar');
  const mobileToggle = document.getElementById('mobile-toggle');
  const navMenu = document.getElementById('nav-menu');
  const adminPortalLink = document.getElementById('admin-portal-link');

  // Bind footer admin portal link if present in decrypted DOM
  if (adminPortalLink) {
    adminPortalLink.addEventListener('click', (e) => {
      e.preventDefault();
      openAdminPanel();
    });
  }

  if (navbar) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 20) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    });
  }

  // Mobile Menu Toggle
  if (mobileToggle && navMenu) {
    mobileToggle.addEventListener('click', () => {
      navMenu.classList.toggle('active');
    });
  }

  // Close mobile menu when a link is clicked
  const navLinks = document.querySelectorAll('.nav-link, .btn');
  if (navLinks && navMenu) {
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('active');
      });
    });
  }


  // ==========================================
  // 2. Hero Section: Mock Floating Panel Tabs
  // ==========================================
  const tabButtons = document.querySelectorAll('.panel-tab-btn');
  const tabContents = document.querySelectorAll('.panel-tab-content');

  if (tabButtons && tabContents) {
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-panel-tab');
        
        // Update button active state
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update content active state
        tabContents.forEach(content => {
          if (content.id === `tab-${targetTab}`) {
            content.classList.add('active');
          } else {
            content.classList.remove('active');
          }
        });
      });
    });
  }

  // Mock User Tag addition in Hero panel
  const mockUserTagsContainer = document.getElementById('mock-user-tags');
  if (mockUserTagsContainer) {
    const addTagBtn = mockUserTagsContainer.querySelector('.tag-add-btn');
    const mockTags = ['民事舉證責任', '爭點整理', '新裁判分析'];
    let mockTagIdx = 0;

    if (addTagBtn) {
      addTagBtn.addEventListener('click', () => {
        if (mockTagIdx < mockTags.length) {
          const newTag = document.createElement('span');
          newTag.className = 'tag tag-user';
          newTag.textContent = mockTags[mockTagIdx];
          
          // Insert before the Add button
          mockUserTagsContainer.insertBefore(newTag, addTagBtn);
          mockTagIdx++;
          
          // If we used all mock tags, hide button
          if (mockTagIdx === mockTags.length) {
            addTagBtn.style.display = 'none';
          }
        }
      });
    }
  }


  // ==========================================
  // 3. Interactive RAG Console Sandbox Data
  // ==========================================
  const caseDatabase = {
    'theft-case': {
      caseNo: '112 年度易字第 120 號',
      cause: '刑事竊盜案',
      summaryHtml: `
        <div class="court-fact-box">
          <div>
            <div class="fact-title">📜 判決事实摘要 (AI 整理)</div>
            <div class="fact-txt">被告林○○於 112 年 2 月間，在臺北巿路旁私有空地取走被害人張○○停放之生鏽腳踏車乙部。林○○辯稱該車輪胎沒氣、外觀滿是灰塵且未上鎖，客觀上形同廢棄物，其主觀上認為是「無主廢棄物」而非竊盜。法院審理後不予採信，判處拘役 10 日。</div>
          </div>
          <div class="issue-item">
            <div class="fact-title text-primary">⚖️ 爭點 1：被告有無竊盜之不法所有意圖？</div>
            <p><strong>兩造主張：</strong>檢察官起訴林○○意圖不法取得他人財產；被告抗辯是誤認該物為廢棄垃圾而無故意。</p>
            <p><strong>法院心證：</strong>該腳踏車雖有鏽蝕，但鍊條與剎車功能完好，且停在住宅旁的私有空地，非垃圾堆置場。社會大眾停放車輛未上鎖屬常見，不能單憑無鎖、鏽蝕即推定為無主物。被告未加確認即逕行騎走，顯有不法所有之故意。</p>
          </div>
          <div class="issue-item">
            <div class="fact-title text-primary">⚖️ 爭點 2：量刑輕重與易科罰金？</div>
            <p><strong>法院判決：</strong>審酌被告無前科，且事後已返還腳踏車。判處拘役 10 日，准以新臺幣 1,000 元折算一日易科罰金。</p>
          </div>
        </div>
      `,
      suggestions: [
        '被告為什麼主張自己無竊盜意圖？',
        '法院最後是怎麼判的？',
        '這個判決適用了什麼刑法法條？'
      ],
      chatResponses: {
        '被告為什麼主張自己無竊盜意圖？': {
          similarity: '98%',
          source: '中華民國刑法第 320 條、判決事實二（被告答辯）',
          answer: '被告林○○主張該腳踏車滿是灰塵、車身生鏽，且停放在路邊沒有上鎖，因此他在主觀上認為這部腳踏車是沒人要的「無主廢棄物」。因為他缺乏不法所有之意圖，故認為自己不構成刑法竊盜罪。'
        },
        '法院最後是怎麼判的？': {
          similarity: '96%',
          source: '判決主文、量刑理由',
          answer: '法院最終認定被告竊盜罪成立。考量到該腳踏車的實際功能完好、且停放位置為私有土地，不採信被告的誤認說。法院審酌林○○無前科且車輛已發還被害人，依普通竊盜罪判處<strong>拘役 10 日</strong>，得易科罰金（一日折算一千元）。'
        },
        '這個判決適用了什麼刑法法條？': {
          similarity: '92%',
          source: '判決理由四（適用法條）',
          answer: '本案適用了<strong>刑法第 320 條第 1 項</strong>之普通竊盜罪。此外，在宣告刑度時，適用了<strong>刑法第 41 條第 1 項前段</strong>有關易科罰金之折算標準規定。'
        }
      },
      fallbackTemplate: (query) => {
        return {
          similarity: '84% (混合檢索動態生成)',
          source: '判決事實及理由全文',
          answer: `您詢問的「${query}」已透過本地向量切塊庫進行比對。本案係關於被告騎走住宅空地上未上鎖的腳踏車。法院強調：未上鎖、有生鏽的車輛在社會常情下仍受所有權人管領，並非可任意撿拾之無主物。被告有查證義務，未經詢問取走即構成竊盜。`
        };
      }
    },
    'contract-case': {
      caseNo: '111 年度訴字第 450 號',
      cause: '民事工程款與違約金爭議',
      summaryHtml: `
        <div class="court-fact-box">
          <div>
            <div class="fact-title">📜 判決事实摘要 (AI 整理)</div>
            <div class="fact-txt">原告（建大工程）承攬被告（鼎新科技）之廠房水電工程，總價 1,200 萬元。合約約定應於 110 年 10 月完工，但原告遲至 111 年 2 月才交付。被告依約扣減逾期違約金每日千分之一，累計扣款 120 萬元。原告主張工程期間爆發本土疫情，工人遭隔離致工期延誤，屬不可抗力，起訴請求給付工程尾款。</div>
          </div>
          <div class="issue-item">
            <div class="fact-title text-primary">⚖️ 爭點 1：新冠疫情是否構成免責之「不可抗力」？</div>
            <p><strong>兩造主張：</strong>原告主張疫情致全國警戒、缺工屬不可抗力；被告抗辯政府並無下令強制停工，是原告自行調配人力不力。</p>
            <p><strong>法院心證：</strong>工程期間政府雖公告三級警戒，但並無勒令本件水電營造工地停工。原告未能舉證有「集體確診致完全無法施工」之具體事實。且原告未依合約約定於事件發生 7 日內書面申請工期展延，難以疫情為由免除遲延責任。</p>
          </div>
          <div class="issue-item">
            <div class="fact-title text-primary">⚖️ 爭點 2：違約金 120 萬元是否過高而應予酌減？</div>
            <p><strong>法院心證：</strong>本件工程雖逾期，但原告已全部完工，且被告已點交進駐使用。審酌遲延對被告營運之損害，與工程履約實質程度，認定原約定之 120 萬違約金過高。依民法第 252 條規定，本院裁量酌減至 60 萬元為適當。判決被告應返還原告 60 萬元。</p>
          </div>
        </div>
      `,
      suggestions: [
        '新冠疫情能作為工程延遲免罰的理由嗎？',
        '法院最後退還了多少工程違約金？為什麼？',
        '判決提及了哪些民法條文？'
      ],
      chatResponses: {
        '新冠疫情能作為工程延遲免罰的理由嗎？': {
          similarity: '97%',
          source: '民法第 230 條、工程契約第 12 條',
          answer: '法院認為<strong>不能一概而論</strong>。在本案中，雖然面臨本土疫情，但政府並未勒令該工地停工。原告未能舉證其個別工人確診達「完全無法施工」之不可抗力程度，且原告沒有按照合約約定在延誤發生 7 日內「書面申請展延」。因此，法院不認同疫情可作為本案免責的理由。'
        },
        '法院最後退還了多少工程違約金？為什麼？': {
          similarity: '95%',
          source: '民法第 252 條、酌減違約金之心證說明',
          answer: '法院判決被告應退還原告<strong> 60 萬元</strong>。原因在於原告雖然遲延，但已將水電工程「全部完工」並交付被告使用。法院依民法第 252 條規定，考量被告已獲得工程之利益，判定原本扣罰 120 萬元違約金過高，職權酌減為 60 萬元，所以被告必須將多扣的 60 萬元返還。'
        },
        '判決提及了哪些民法條文？': {
          similarity: '89%',
          source: '民法條文檢索命中',
          answer: '本案核心引用了<strong>民法第 252 條</strong>（違約金過高之酌減權利）以及<strong>民法第 230 條</strong>（因不可歸責於債務人之事由致遲延者不負遲延責任）進行論理裁判。'
        }
      },
      fallbackTemplate: (query) => {
        return {
          similarity: '83% (混合檢索動態生成)',
          source: '民事判決心證理由',
          answer: `關於您詢問的「${query}」，本案是一起給付承攬工程尾款糾紛。主要焦點在於承攬人因疫情遲延完工。法院認定疫情未導致工地停工，非不可抗力，但衡量承攬人已履行完畢、定作人已享受利益，因此援引民法酌減條款，將違約金減半，判令定作人返還部分工程尾款。`
        };
      }
    },
    'labor-case': {
      caseNo: '100 年度勞訴字第 85 號',
      cause: '民事確認僱傭關係存在',
      summaryHtml: `
        <div class="court-fact-box">
          <div>
            <div class="fact-title">📜 判決事实摘要 (AI 整理)</div>
            <div class="fact-txt">原告任職於被告公司擔任資深軟體工程師，工作年資 5 年。被告公司於 110 年 7 月以「業務緊縮、部門虧損裁撤」為由，依勞動基準法第 11 條第 2 款預告資遣原告。原告主張被告公司整體營收成長，且有其他部門職缺卻不予安置，解雇違反「最後手段性」，訴請確認僱傭關係存在。法院判決原告勝訴。</div>
          </div>
          <div class="issue-item">
            <div class="fact-title text-primary">⚖️ 爭點 1：被告公司是否符合勞基法之「業務緊縮」要件？</div>
            <p><strong>兩造主張：</strong>被告抗辯其所屬的行動應用部門持續虧損、業務萎縮；原告主張公司整體營收歷史新高，並非業務緊縮。</p>
            <p><strong>法院心證：</strong>勞基法所稱「業務緊縮」，應以企業「整體營業額」或「生產額」是否有相當期間之減少為準。不能以單一部門之損益調整，即認定公司整體業務緊縮。經查被告整體營業額逆勢成長，且仍在招募新進工程師，因此不符業務緊縮要件。</p>
          </div>
          <div class="issue-item">
            <div class="fact-title text-primary">⚖️ 爭點 2：被告公司資遣是否違反「解雇最後手段性」？</div>
            <p><strong>法院心證：</strong>憲法保障生存權與工作權。雇主資遣員工前，有義務先輔導轉任其他部門或進行職能培訓。被告公司尚有其他技術職缺，卻完全未與原告協商調動或安排轉調，即直接予以資遣，顯然違背最後手段性。資遣行為無效，雙方僱傭關係依然存在。</p>
          </div>
        </div>
      `,
      suggestions: [
        '什麼是解雇最後手段性原則？',
        '公司單一部門虧損可以作為業務緊縮資遣的理由嗎？',
        '原告勝訴後可以拿到之前沒發的薪水嗎？'
      ],
      chatResponses: {
        '什麼是解雇最後手段性原則？': {
          similarity: '99%',
          source: '勞動基準法第 11 條之心證法理',
          answer: '<strong>解雇最後手段性原則</strong>是指：雇主解雇或資遣員工，必須是在「無其他方法可行」的萬不得已情況下，才能採取的最嚴厲手段。如果雇主尚有其他部門職缺、或是可以透過培訓、調職等方式安置員工，卻不予安置而直接資遣，該資遣即屬違法無效。'
        },
        '公司單一部門虧損可以作為業務緊縮資遣的理由嗎？': {
          similarity: '96%',
          source: '勞動基準法第 11 條第 2 款解釋',
          answer: '法院認為<strong>不可以</strong>。勞基法第 11 條第 2 款的「業務緊縮」，必須指雇主「整體的營運或業務額」有相當期間之減少。不能單憑公司「個別部門」或「特定產品線」的裁撤、調整或虧損，就主張整體業務緊縮。特別是公司整體營業額仍在成長時，不能以此由資遣員工。'
        },
        '原告勝訴後可以拿到之前沒發的薪水嗎？': {
          similarity: '93%',
          source: '民法第 487 條、判決主文第二項',
          answer: '可以。法院判定雙方僱傭關係存在，代表被告公司的資遣無效，雙方勞動契約未曾中斷。依據<strong>民法第 487 條</strong>規定，雇主拒絕受領勞工提供勞務，仍應按期給付薪資。因此，法院判決被告應補發自解雇日起至原告復職日止的<strong>按月薪資及提撥勞退金</strong>。'
        }
      },
      fallbackTemplate: (query) => {
        return {
          similarity: '85% (混合檢索動態生成)',
          source: '確認僱傭關係訴訟判決書',
          answer: `關於「${query}」，本案判決確立了雇主在行使資遣權時，必須遵循「最後手段性原則」。法院查明被告公司營收成長且有其他研發缺口，卻未履行安置調職義務即直接解雇原告。法院因而宣告解雇無效，判決原告復職並補發訴訟期間薪資。`
        };
      }
    }
  };

  // Active state tracks
  let currentCaseId = 'theft-case';
  let chatHistory = {
    'theft-case': [],
    'contract-case': [],
    'labor-case': []
  };

  const caseItems = document.querySelectorAll('.case-item');
  const activeCaseNoSpan = document.getElementById('active-case-no');
  const activeCaseCauseSpan = document.getElementById('active-case-cause');
  const paneSummaryText = document.getElementById('pane-summary-text');
  const paneChatBox = document.getElementById('pane-chat-box');
  const paneSuggestions = document.getElementById('pane-suggestions');
  const chatInputForm = document.getElementById('chat-input-form');
  const chatUserInput = document.getElementById('chat-user-input');

  // Initialize Simulator with the default case
  loadCase('theft-case');

  if (caseItems) {
    caseItems.forEach(item => {
      item.addEventListener('click', () => {
        const caseId = item.getAttribute('data-case-id');
        
        // Update sidebar visual selection
        caseItems.forEach(c => c.classList.remove('active'));
        item.classList.add('active');

        loadCase(caseId);
      });
    });
  }

  // Load selected case into Console
  function loadCase(caseId) {
    currentCaseId = caseId;
    const caseData = caseDatabase[caseId];

    // Update Header
    if (activeCaseNoSpan) activeCaseNoSpan.textContent = caseData.caseNo;
    if (activeCaseCauseSpan) activeCaseCauseSpan.textContent = caseData.cause;

    // Trigger Shimmer Loaders
    if (paneSummaryText) {
      paneSummaryText.innerHTML = `
        <div class="loading-shimmer">
          <div class="line"></div>
          <div class="line"></div>
          <div class="line"></div>
          <div class="line"></div>
        </div>
      `;
    }

    if (paneChatBox) {
      paneChatBox.innerHTML = `
        <div class="loading-shimmer">
          <div class="line"></div>
          <div class="line"></div>
        </div>
      `;
    }

    if (paneSuggestions) paneSuggestions.innerHTML = '';

    // Simulate analysis delay
    setTimeout(() => {
      // 1. Populate summary
      if (paneSummaryText) paneSummaryText.innerHTML = caseData.summaryHtml;

      // 2. Populate suggestions
      if (paneSuggestions) {
        paneSuggestions.innerHTML = '';
        caseData.suggestions.forEach(q => {
          const btn = document.createElement('button');
          btn.className = 'suggestion-btn cursor-pointer';
          btn.textContent = q;
          btn.addEventListener('click', () => handleSuggestionClick(q));
          paneSuggestions.appendChild(btn);
        });
      }

      // 3. Render chat history or default welcome message
      renderChat(caseId);
    }, 600);
  }

  // Handle clicking suggested question
  function handleSuggestionClick(questionText) {
    addUserMessage(questionText);
    simulateAiResponse(questionText);
  }

  // Handle manual input form
  if (chatInputForm) {
    chatInputForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const queryText = chatUserInput.value.trim();
      if (!queryText) return;

      chatUserInput.value = '';
      addUserMessage(queryText);
      simulateAiResponse(queryText);
    });
  }

  // Render chat messages based on history
  function renderChat(caseId) {
    if (!paneChatBox) return;
    paneChatBox.innerHTML = '';
    const history = chatHistory[caseId];

    if (history.length === 0) {
      // Add a greeting from AI
      paneChatBox.innerHTML = `
        <div class="chat-bubble ai">
          <span class="chat-bubble-similarity">向量檢索已就緒</span>
          <span>您好！我是法律判決 AI 助理。我已經對此判決書（${caseDatabase[caseId].caseNo}）建立了 768 維度的 RAG 本地索引。您可以點選下方的預設問題，或直接在對話框內以中文自然語言提問。</span>
        </div>
      `;
    } else {
      history.forEach(msg => {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${msg.role}`;
        
        if (msg.role === 'ai') {
          bubble.innerHTML = `
            <span class="chat-bubble-similarity">RAG 混合檢索命中 (${msg.similarity})</span>
            <span>${msg.text}</span>
            <span class="chat-bubble-source">引用來源：${msg.source}</span>
          `;
        } else {
          bubble.textContent = msg.text;
        }
        paneChatBox.appendChild(bubble);
      });
      // Scroll to bottom
      paneChatBox.scrollTop = paneChatBox.scrollHeight;
    }
  }

  function addUserMessage(text) {
    chatHistory[currentCaseId].push({
      role: 'user',
      text: text
    });
    renderChat(currentCaseId);
  }

  // Simulating typing delay + AI reply
  function simulateAiResponse(query) {
    if (!paneChatBox) return;
    const caseData = caseDatabase[currentCaseId];
    
    // Create temporary typing bubble
    const typingBubble = document.createElement('div');
    typingBubble.className = 'chat-bubble ai';
    typingBubble.id = 'temp-typing';
    typingBubble.innerHTML = `
      <div class="loading-shimmer" style="width: 100px; gap: 4px;">
        <div class="line" style="height: 10px;"></div>
      </div>
    `;
    paneChatBox.appendChild(typingBubble);
    paneChatBox.scrollTop = paneChatBox.scrollHeight;

    // Search matches
    let answerObj = caseData.chatResponses[query];
    if (!answerObj) {
      // Use dynamic fallback template
      answerObj = caseData.fallbackTemplate(query);
    }

    setTimeout(() => {
      // Remove typing bubble
      const tb = document.getElementById('temp-typing');
      if (tb) tb.remove();

      // Add actual response to history
      chatHistory[currentCaseId].push({
        role: 'ai',
        similarity: answerObj.similarity,
        source: answerObj.source,
        text: answerObj.answer
      });

      renderChat(currentCaseId);
    }, 1000);
  }
}

