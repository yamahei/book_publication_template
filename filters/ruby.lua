-- filters/ruby.lua
-- Markdown内の <ruby>親文字<rt>ルビ</rt></ruby> を LaTeX の \ruby{親文字}{ルビ} に変換するフィルタ
-- および、見出しの改ページ・扉ページ化・しおり用ルビ除去を行うフィルタ

local function process_inlines(inlines)
  local new_inlines = {}
  local latex_parts = {}
  local plain_parts = {}
  local i = 1
  while i <= #inlines do
    local el = inlines[i]
    if el.t == "RawInline" and el.format == "latex" and el.text:match("^\\ruby{") then
      local rb, rt = el.text:match("^\\ruby{([^}]+)}{([^}]+)}")
      if rb then
        table.insert(new_inlines, el)
        table.insert(latex_parts, el.text)
        table.insert(plain_parts, rb)
      else
        table.insert(new_inlines, el)
        table.insert(latex_parts, el.text)
      end
      i = i + 1
    elseif el.t == "RawInline" and el.format == "html" and el.text:match("^<ruby") then
      local rb_text = ""
      local rt_text = ""
      i = i + 1
      -- <rt> が来るまでを親文字として収集
      while i <= #inlines do
        local curr = inlines[i]
        if curr.t == "RawInline" and curr.format == "html" and curr.text:match("^<rt") then
          i = i + 1
          break
        else
          rb_text = rb_text .. pandoc.utils.stringify(curr)
          i = i + 1
        end
      end
      -- </rt> または </ruby> が来るまでをルビ文字として収集
      while i <= #inlines do
        local curr = inlines[i]
        if curr.t == "RawInline" and curr.format == "html" and (curr.text:match("^</rt") or curr.text:match("^</ruby")) then
          if curr.text:match("^</rt") then
            i = i + 1
            if i <= #inlines and inlines[i].t == "RawInline" and inlines[i].text:match("^</ruby") then
              i = i + 1
            end
          else
            i = i + 1
          end
          break
        else
          rt_text = rt_text .. pandoc.utils.stringify(curr)
          i = i + 1
        end
      end
      local ruby_tex = "\\ruby{" .. rb_text .. "}{" .. rt_text .. "}"
      table.insert(new_inlines, pandoc.RawInline("latex", ruby_tex))
      table.insert(latex_parts, ruby_tex)
      table.insert(plain_parts, rb_text)
    else
      table.insert(new_inlines, el)
      local s = pandoc.utils.stringify(el)
      table.insert(latex_parts, s)
      table.insert(plain_parts, s)
      i = i + 1
    end
  end
  return new_inlines, table.concat(latex_parts), table.concat(plain_parts)
end

function Inlines(inlines)
  if not FORMAT:match('latex') then
    return inlines
  end
  local new_inlines, _, _ = process_inlines(inlines)
  return new_inlines
end

function Header(el)
  if not FORMAT:match('latex') then
    return el
  end

  local _, latex_title, plain_title = process_inlines(el.content)
  local label = el.identifier
  local label_cmd = ""
  if label and label ~= "" then
    label_cmd = "\\label{" .. label .. "}"
  end

  if el.level == 1 then
    -- 章題：左ページ（偶数ページ）起こし。タイトル後の改ページはなし（項題・本文と並べる）
    local cmd = "\\cleartoleftpage\n\\section[" .. plain_title .. "]{\\texorpdfstring{" .. latex_title .. "}{" .. plain_title .. "}}" .. label_cmd
    return pandoc.RawBlock("latex", cmd)
  elseif el.level == 2 then
    -- 項題：改ページなしで章題に続けて並べる
    local cmd = "\\subsection[" .. plain_title .. "]{\\texorpdfstring{" .. latex_title .. "}{" .. plain_title .. "}}" .. label_cmd
    return pandoc.RawBlock("latex", cmd)
  end

  return el
end

