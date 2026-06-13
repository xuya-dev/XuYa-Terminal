const ESC: u8 = 0x1b;
const LBRACKET: u8 = 0x5b;
const RBRACKET: u8 = 0x5d;
const BEL: u8 = 0x07;
const BACKSLASH: u8 = 0x5c;
const FINAL_C: u8 = 0x63;
const PREFIX_GT: u8 = 0x3e;
const PREFIX_EQ: u8 = 0x3d;

const DA1_REPLY: &[u8] = b"\x1b[?1;2c";
const DA2_REPLY: &[u8] = b"\x1b[>0;276;0c";

const HOLD_MAX: usize = 256;

#[derive(Clone, Copy)]
enum State {
    Idle,
    AfterEsc,
    InsideCsi,
    InsideOsc,
    OscEsc,
}

#[derive(Clone, Debug)]
pub struct TerminalColors {
    pub foreground: String,
    pub background: String,
    pub cursor: String,
}

pub struct DaFilter {
    state: State,
    hold: Vec<u8>,
}

impl DaFilter {
    pub fn new() -> Self {
        DaFilter {
            state: State::Idle,
            hold: Vec::with_capacity(16),
        }
    }

    pub fn process<F: FnMut(&[u8])>(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        colors: &TerminalColors,
        mut respond: F,
    ) {
        if matches!(self.state, State::Idle) && !input.contains(&ESC) {
            out.extend_from_slice(input);
            return;
        }

        for &b in input {
            match self.state {
                State::Idle => {
                    if b == ESC {
                        self.state = State::AfterEsc;
                        self.hold.clear();
                        self.hold.push(b);
                    } else {
                        out.push(b);
                    }
                }
                State::AfterEsc => {
                    if b == LBRACKET {
                        self.state = State::InsideCsi;
                        self.hold.push(b);
                    } else if b == RBRACKET {
                        self.state = State::InsideOsc;
                        self.hold.push(b);
                    } else if b == ESC {
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.hold.push(b);
                    } else {
                        out.extend_from_slice(&self.hold);
                        out.push(b);
                        self.hold.clear();
                        self.state = State::Idle;
                    }
                }
                State::InsideOsc => {
                    self.hold.push(b);
                    if b == BEL {
                        self.handle_osc(out, colors, &mut respond);
                    } else if b == ESC {
                        self.state = State::OscEsc;
                    } else if self.hold.len() >= HOLD_MAX {
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.state = State::Idle;
                    }
                }
                State::OscEsc => {
                    self.hold.push(b);
                    if b == BACKSLASH {
                        self.handle_osc(out, colors, &mut respond);
                    } else if b == ESC {
                        self.state = State::AfterEsc;
                    } else if self.hold.len() >= HOLD_MAX {
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.state = State::Idle;
                    } else {
                        self.state = State::InsideOsc;
                    }
                }
                State::InsideCsi => {
                    self.hold.push(b);
                    if (0x40..=0x7e).contains(&b) {
                        if b == FINAL_C {
                            let middle = &self.hold[2..self.hold.len() - 1];
                            let is_response = middle.contains(&b'?') || middle.contains(&b';');
                            let prefix = middle.first().copied().unwrap_or(0);
                            if is_response {
                                out.extend_from_slice(&self.hold);
                            } else {
                                match prefix {
                                    PREFIX_GT => respond(DA2_REPLY),
                                    PREFIX_EQ => {}
                                    0 | b'0'..=b'9' => respond(DA1_REPLY),
                                    _ => out.extend_from_slice(&self.hold),
                                }
                            }
                        } else {
                            out.extend_from_slice(&self.hold);
                        }
                        self.hold.clear();
                        self.state = State::Idle;
                    } else if self.hold.len() >= HOLD_MAX {
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.state = State::Idle;
                    }
                }
            }
        }
    }

    fn handle_osc<F: FnMut(&[u8])>(
        &mut self,
        out: &mut Vec<u8>,
        colors: &TerminalColors,
        respond: &mut F,
    ) {
        let body_end = if self.hold.ends_with(&[ESC, BACKSLASH]) {
            self.hold.len() - 2
        } else {
            self.hold.len() - 1
        };
        let body = &self.hold[2..body_end];
        if let Some(reply) = osc_color_query_reply(body, colors) {
            respond(reply.as_bytes());
        } else {
            out.extend_from_slice(&self.hold);
        }
        self.hold.clear();
        self.state = State::Idle;
    }
}

fn osc_color_query_reply(body: &[u8], colors: &TerminalColors) -> Option<String> {
    let text = std::str::from_utf8(body).ok()?;
    let (code, value) = text.split_once(';')?;
    if value != "?" {
        return None;
    }
    let color = match code {
        "10" => &colors.foreground,
        "11" => &colors.background,
        "12" => &colors.cursor,
        _ => return None,
    };
    let rgb = hex_to_rgb(color)?;
    Some(format!(
        "\x1b]{code};rgb:{:04x}/{:04x}/{:04x}\x1b\\",
        rgb.0 * 257,
        rgb.1 * 257,
        rgb.2 * 257
    ))
}

fn hex_to_rgb(value: &str) -> Option<(u16, u16, u16)> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some((
        u16::from_str_radix(&hex[0..2], 16).ok()?,
        u16::from_str_radix(&hex[2..4], 16).ok()?,
        u16::from_str_radix(&hex[4..6], 16).ok()?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(filter: &mut DaFilter, input: &[u8]) -> (Vec<u8>, Vec<Vec<u8>>) {
        let mut out = Vec::new();
        let mut replies = Vec::new();
        filter.process(input, &mut out, &test_colors(), |r| {
            replies.push(r.to_vec())
        });
        (out, replies)
    }

    fn test_colors() -> TerminalColors {
        TerminalColors {
            foreground: "#112233".into(),
            background: "#ffffff".into(),
            cursor: "#445566".into(),
        }
    }

    #[test]
    fn da1_bare() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn da1_with_zero_param() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[0c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn da2_secondary() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[>c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA2_REPLY.to_vec()]);
    }

    #[test]
    fn da3_consumed_silently() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[=c");
        assert!(out.is_empty());
        assert!(replies.is_empty());
    }

    #[test]
    fn plain_text_passes_through() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"hello world\n");
        assert_eq!(out, b"hello world\n");
        assert!(replies.is_empty());
    }

    #[test]
    fn embedded_da_preserves_surrounding() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"pre\x1b[0cpost");
        assert_eq!(out, b"prepost");
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn non_da_csi_passes_through() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[?2004h");
        assert_eq!(out, b"\x1b[?2004h");
        assert!(replies.is_empty());
    }

    #[test]
    fn split_across_chunks() {
        let mut f = DaFilter::new();
        let (out1, r1) = run(&mut f, b"\x1b");
        let (out2, r2) = run(&mut f, b"[");
        let (out3, r3) = run(&mut f, b"c");
        assert!(out1.is_empty() && out2.is_empty() && out3.is_empty());
        assert!(r1.is_empty() && r2.is_empty());
        assert_eq!(r3, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn escape_then_non_csi() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1bM");
        assert_eq!(out, b"\x1bM");
        assert!(replies.is_empty());
    }

    #[test]
    fn double_esc() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b\x1b[c");
        assert_eq!(out, b"\x1b");
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn da1_response_passes_through_no_loop() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[?1;2c");
        assert_eq!(out, b"\x1b[?1;2c");
        assert!(replies.is_empty());
    }

    #[test]
    fn da2_response_passes_through_no_loop() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[>0;276;0c");
        assert_eq!(out, b"\x1b[>0;276;0c");
        assert!(replies.is_empty());
    }

    #[test]
    fn da_with_question_prefix_is_response() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[?6c");
        assert_eq!(out, b"\x1b[?6c");
        assert!(replies.is_empty());
    }

    #[test]
    fn runaway_csi_flushes_at_hold_max() {
        let mut f = DaFilter::new();
        let mut input = Vec::from(b"\x1b[".as_slice());
        input.extend(std::iter::repeat_n(b'0', HOLD_MAX));
        let (out, replies) = run(&mut f, &input);
        assert_eq!(out.len(), HOLD_MAX + 2);
        assert!(replies.is_empty());
    }

    #[test]
    fn osc_background_query_replies() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b]11;?\x07");
        assert!(out.is_empty());
        assert_eq!(replies, vec![b"\x1b]11;rgb:ffff/ffff/ffff\x1b\\".to_vec()]);
    }

    #[test]
    fn osc_foreground_query_st_terminated_replies() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b]10;?\x1b\\");
        assert!(out.is_empty());
        assert_eq!(replies, vec![b"\x1b]10;rgb:1111/2222/3333\x1b\\".to_vec()]);
    }

    #[test]
    fn non_color_osc_passes_through() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b]0;title\x07");
        assert_eq!(out, b"\x1b]0;title\x07");
        assert!(replies.is_empty());
    }
}
