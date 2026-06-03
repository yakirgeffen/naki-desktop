import { useState, useEffect, Fragment } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

interface MediaBreakdown {
  videos: number;
  images: number;
  audio: number;
  documents: number;
  other: number;
}

interface ChatInfo {
  jid: string;
  name: string;
  is_group: boolean; // New field to identify if it's a group chat or individual
  size_bytes: number;
  breakdown: MediaBreakdown;
  last_active: number | null;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 MB";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export default function App() {
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [selectedJids, setSelectedJids] = useState<Set<string>>(new Set());
  const [expandedJids, setExpandedJids] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [showTrashModal, setShowTrashModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // --- License State ---
  const [isPro, setIsPro] = useState(false);
  const [hasUsedFreeSweep, setHasUsedFreeSweep] = useState(false);
  const [showLicenseModal, setShowLicenseModal] = useState(false);
  const [licenseKey, setLicenseKey] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [licenseError, setLicenseError] = useState("");

  // --- EULA Gate (CSO-Security: required before first scan) ---
  const [showEulaModal, setShowEulaModal] = useState(false);

  useEffect(() => {
    // Check our hidden config file on boot
    invoke("get_license_state").then((state: any) => {
      setIsPro(state.is_pro);
      setHasUsedFreeSweep(state.has_used_free_sweep);
      if (!state.eula_accepted) {
        // Gate: must accept EULA before any scan runs
        setShowEulaModal(true);
      } else {
        fetchChats();
      }
    });
  }, []);

  const handleAcceptEula = async () => {
    await invoke("accept_eula");
    setShowEulaModal(false);
    fetchChats();
  };

  const fetchChats = () => {
    setLoading(true);
    invoke<ChatInfo[]>("scan_chats")
      .then((data) => {
        setChats(data);
        setSelectedJids(new Set());
        setExpandedJids(new Set());
        setLastSelectedIndex(null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err as string);
        setLoading(false);
      });
  };

  const toggleSelection = (jid: string, index: number, e: React.MouseEvent) => {
    const newSet = new Set(selectedJids);

    if (e.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      for (let i = start; i <= end; i++) {
        newSet.add(chats[i].jid);
      }
    } else {
      if (newSet.has(jid)) {
        newSet.delete(jid);
      } else {
        newSet.add(jid);
      }
    }
    
    setSelectedJids(newSet);
    setLastSelectedIndex(index);
  };

  const toggleExpand = (e: React.MouseEvent, jid: string) => {
    e.stopPropagation(); 
    const newSet = new Set(expandedJids);
    if (newSet.has(jid)) {
      newSet.delete(jid);
    } else {
      newSet.add(jid);
    }
    setExpandedJids(newSet);
  };

  const handleClearClick = () => {
    if (!isPro && hasUsedFreeSweep) {
      setShowLicenseModal(true);
    } else {
      setShowTrashModal(true);
    }
  };

  const executeDelete = async () => {
    setIsDeleting(true);
    try {
      await invoke("delete_media", { jids: Array.from(selectedJids) });
      setShowTrashModal(false);
      setHasUsedFreeSweep(true); // Update UI state locally so they are locked for the next click
      fetchChats(); 
    } catch (err) {
      setError(err as string);
      setShowTrashModal(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const verifyLicense = async () => {
    if (!licenseKey.trim()) return;
    setIsVerifying(true);
    setLicenseError("");
    try {
      const valid = await invoke<boolean>("verify_gumroad_license", { license_key: licenseKey.trim() });
      if (valid) {
        setIsPro(true);
        setShowLicenseModal(false);
      } else {
        setLicenseError("INVALID LICENSE KEY");
      }
    } catch (err) {
      setLicenseError("NETWORK ERROR");
    } finally {
      setIsVerifying(false);
    }
  };

  const openCheckout = async () => {
    // Replace with your actual Gumroad product link
    await openUrl("https://yakirgeffen.gumroad.com/l/naki?utm_source=app&utm_medium=upgrade-prompt&utm_campaign=naki-launch-w1");
  };

  const selectedChats = chats.filter((c) => selectedJids.has(c.jid));
  const totalSelectedBytes = selectedChats.reduce((sum, c) => sum + c.size_bytes, 0);

  if (loading && chats.length === 0 && !showEulaModal) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#E8ECEF] text-[#4A4A4A] select-none uppercase tracking-widest text-xs font-bold">
        <p>Scanning...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#E8ECEF] text-[#4A4A4A] p-6 select-none">
        <div className="bg-white p-6 rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.1)] border border-[#D1D1D1]">
          <h2 className="text-[11px] font-bold tracking-widest uppercase mb-2 text-red-600">Fatal Error</h2>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#F4F5F7] text-[#333333] font-sans relative select-none">
      
      {/* --- STANDARD TRASH MODAL --- */}
      {/* --- EULA MODAL (first-launch gate, CSO-Security required) --- */}
      {showEulaModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#F4F5F7]/90 backdrop-blur-md">
          <div className="bg-white w-[440px] shadow-[0_20px_60px_rgba(0,0,0,0.15)] border border-[#E0E0E0] overflow-hidden flex flex-col">
            <div className="p-8 pb-6">
              <h3 className="text-[11px] tracking-[0.2em] font-black uppercase text-[#111] mb-4">Before You Begin</h3>
              <p className="text-[13px] text-[#555] leading-relaxed mb-3 font-medium">
                Naki is an independent utility. It is not affiliated with, endorsed by, or connected to WhatsApp or Meta Platforms.
              </p>
              <p className="text-[13px] text-[#555] leading-relaxed mb-3 font-medium">
                Naki accesses your local WhatsApp storage in read-only mode to display chat sizes. Deleted files go to your macOS Trash; they are not permanently removed until you empty the Trash. No data is transmitted to any server.
              </p>
              <p className="text-[13px] text-[#555] leading-relaxed mb-6 font-medium">
                You are responsible for verifying what you delete. Back up anything you are not certain about before running a sweep.
              </p>
              <button
                onClick={handleAcceptEula}
                className="w-full bg-[#111] text-white py-2.5 text-[11px] font-bold uppercase tracking-[0.1em] hover:bg-[#333] active:bg-black transition-colors"
              >
                I Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {showTrashModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="bg-gradient-to-b from-[#FFFFFF] to-[#EAEAEA] w-80 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.2),0_1px_3px_rgba(0,0,0,0.1)] border border-[#C4C4C4] overflow-hidden flex flex-col">
            <div className="p-6 text-center">
              <h3 className="text-lg font-bold text-[#222] mb-2 drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">Move to Trash?</h3>
              <p className="text-sm text-[#555] leading-relaxed">
                You are about to move media from <span className="font-semibold">{selectedJids.size} group(s)</span> to the macOS Trash. This will free up <span className="font-semibold">{formatBytes(totalSelectedBytes)}</span> of space.
              </p>
            </div>
            <div className="flex border-t border-[#C4C4C4] bg-[#F4F4F4]">
              <button 
                onClick={() => setShowTrashModal(false)}
                disabled={isDeleting}
                className="flex-1 py-3 text-[#007AFF] font-medium border-r border-[#C4C4C4] hover:bg-[#EBEBEB] active:bg-[#DEDEDE] transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={executeDelete}
                disabled={isDeleting}
                className="flex-1 py-3 text-red-500 font-bold hover:bg-[#EBEBEB] active:bg-[#DEDEDE] transition-colors disabled:opacity-50"
              >
                {isDeleting ? "Moving..." : "Move to Trash"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- GUMROAD LICENSE MODAL (BRUTALIST / MONOCHROMATIC) --- */}
      {showLicenseModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#F4F5F7]/90 backdrop-blur-md">
          <div className="bg-white w-[380px] shadow-[0_20px_60px_rgba(0,0,0,0.15)] border border-[#E0E0E0] overflow-hidden flex flex-col relative">
            
            <button 
              onClick={() => setShowLicenseModal(false)}
              className="absolute top-4 right-4 text-[#999] hover:text-[#111] font-bold text-lg leading-none transition-colors"
            >
              ×
            </button>

            <div className="p-8 pb-6">
              <h3 className="text-[11px] tracking-[0.2em] font-black uppercase text-[#111] mb-4">Unlimited Cleanup</h3>
              <p className="text-[13px] text-[#555] leading-relaxed mb-6 font-medium">
                Your first free sweep is complete. Enter a lifetime license key to continue managing your WhatsApp storage.
              </p>
              
              <div className="space-y-3">
                <input 
                  type="text"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                  placeholder="LICENSE KEY"
                  className="w-full bg-[#F9F9F9] border border-[#D4D4D4] px-3 py-2 text-[12px] font-mono tracking-widest text-[#111] placeholder:text-[#999] focus:outline-none focus:border-[#111] transition-colors"
                />
                
                {licenseError && <p className="text-[10px] tracking-widest font-bold text-red-600">{licenseError}</p>}
                
                <button 
                  onClick={verifyLicense}
                  disabled={isVerifying || !licenseKey.trim()}
                  className="w-full bg-[#111] text-white py-2.5 text-[11px] font-bold uppercase tracking-[0.1em] hover:bg-[#333] active:bg-black transition-colors disabled:opacity-50"
                >
                  {isVerifying ? "VERIFYING..." : "ACTIVATE"}
                </button>
              </div>
            </div>

            <div className="border-t border-[#EAEAEA] bg-[#F9FAFB] p-4 text-center">
              <button 
                onClick={openCheckout}
                className="text-[11px] font-bold tracking-widest uppercase text-[#555] hover:text-[#111] transition-colors underline decoration-[#D4D4D4] underline-offset-4"
              >
                Purchase License
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="px-6 py-3 flex justify-between items-center bg-gradient-to-b from-[#FFFFFF] to-[#EAEAEA] border-b border-[#C4C4C4] shadow-[0_1px_2px_rgba(0,0,0,0.05)] z-10">
        <h1 className="text-md font-bold text-[#333] drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">
          Naki
        </h1>
        <div className="flex items-center gap-3">
          {isPro && (
            <span className="text-[10px] font-black uppercase tracking-widest text-[#111] bg-[#EAEAEA] px-2 py-1 rounded-[4px] border border-[#D4D4D4]">
              PRO
            </span>
          )}
          <span className="text-xs text-[#666] font-medium bg-[#DEDEDE] px-2 py-1 rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] border border-[#C4C4C4]">
            {chats.length} Chats Scanned
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 bg-[#E8ECEF] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
        <div className="bg-white border border-[#C4C4C4] rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.05)] overflow-hidden">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-gradient-to-b from-[#F9F9F9] to-[#EFEFEF] border-b border-[#C4C4C4] text-[#555]">
                <th className="py-2 px-4 font-semibold border-r border-[#E0E0E0] w-12"></th>
                <th className="py-2 px-4 font-semibold border-r border-[#E0E0E0] drop-shadow-[0_1px_1px_rgba(255,255,255,1)]">Group Name</th>
                <th className="py-2 px-4 font-semibold drop-shadow-[0_1px_1px_rgba(255,255,255,1)]">Size</th>
              </tr>
            </thead>
            <tbody>
              {chats.map((chat, index) => {
                const isSelected = selectedJids.has(chat.jid);
                const isExpanded = expandedJids.has(chat.jid);
                
                return (
                  <Fragment key={chat.jid}>
                    <tr 
                      onClick={(e) => toggleSelection(chat.jid, index, e)}
                      className={`border-b border-[#EAEAEA] transition-colors cursor-pointer
                        ${isSelected ? 'bg-[#E3F0FF]' : (index % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFB]')} 
                        hover:bg-[#E3F0FF]`
                      }
                    >
                      <td className="py-2 px-4 border-r border-[#EAEAEA] text-center">
                        <input 
                          type="checkbox" 
                          checked={isSelected}
                          onChange={() => {}} 
                          className="appearance-none w-4 h-4 bg-gradient-to-b from-[#F2F2F2] to-[#E0E0E0] border border-[#A0A0A0] rounded shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] 
                                     checked:bg-gradient-to-b checked:from-[#5698F5] checked:to-[#2D75E8] checked:border-[#1C5ECA] checked:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]
                                     cursor-pointer relative align-middle pointer-events-none
                                     checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:font-bold checked:after:text-xs checked:after:left-[2px] checked:after:-top-[1px]" 
                        />
                      </td>
                      <td className="py-2 px-4 border-r border-[#EAEAEA] font-medium text-[#222]">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-black tracking-[0.1em] text-[#888] bg-[#F4F4F4] px-1.5 py-0.5 rounded-[3px] border border-[#D4D4D4] uppercase">
                            {chat.is_group ? "GROUP" : "DIRECT"}
                          </span>
                          {chat.name}
                        </div>
                      </td>
                      <td className="py-2 px-4 text-[#555] font-medium flex justify-between items-center">
                        <span>{formatBytes(chat.size_bytes)}</span>
                        <button 
                          onClick={(e) => toggleExpand(e, chat.jid)}
                          className="text-[#888] hover:text-[#333] p-1 rounded-md hover:bg-black/5 transition-colors"
                        >
                          {isExpanded ? "▼" : "▶"}
                        </button>
                      </td>
                    </tr>
                    
                    {/* The Scalpel Breakdown - Monochromatic Typography */}
                    {isExpanded && (
                      <tr className="bg-[#F4F5F7] shadow-[inset_0_2px_4px_rgba(0,0,0,0.03)] border-b border-[#EAEAEA]">
                        <td colSpan={3} className="py-3 px-12">
                          <div className="flex gap-8 text-[11px] text-[#666] tracking-wider uppercase font-bold">
                            <div className="flex gap-2"><span className="text-[#999]">VIDEOS</span> <span className="text-[#333] font-medium">{formatBytes(chat.breakdown.videos)}</span></div>
                            <div className="flex gap-2"><span className="text-[#999]">IMAGES</span> <span className="text-[#333] font-medium">{formatBytes(chat.breakdown.images)}</span></div>
                            <div className="flex gap-2"><span className="text-[#999]">AUDIO</span> <span className="text-[#333] font-medium">{formatBytes(chat.breakdown.audio)}</span></div>
                            <div className="flex gap-2"><span className="text-[#999]">DOCS</span> <span className="text-[#333] font-medium">{formatBytes(chat.breakdown.documents)}</span></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>

      <footer className="px-6 py-4 flex justify-between items-center bg-gradient-to-b from-[#EAEAEA] to-[#D4D4D4] border-t border-[#B0B0B0] shadow-[0_-1px_2px_rgba(0,0,0,0.05)] z-10">
        <div className="text-sm text-[#444] font-medium drop-shadow-[0_1px_1px_rgba(255,255,255,0.6)]">
          {selectedJids.size > 0 
            ? <span className="font-bold text-[#222]">{selectedJids.size} groups selected • {formatBytes(totalSelectedBytes)}</span>
            : "0 groups selected"
          }
        </div>
        <button 
          onClick={handleClearClick}
          disabled={selectedJids.size === 0}
          className="bg-gradient-to-b from-[#6EB0FF] to-[#1C75E8] border border-[#1150A6] 
                     shadow-[0_1px_2px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.4)] 
                     text-white px-5 py-1.5 rounded-md text-sm font-semibold tracking-wide
                     active:from-[#1C75E8] active:to-[#1150A6] active:shadow-[inset_0_2px_3px_rgba(0,0,0,0.3)]
                     disabled:from-[#A8C7FA] disabled:to-[#74A3ED] disabled:border-[#6B93D6] disabled:text-[#E2EEFF] disabled:cursor-not-allowed
                     transition-all duration-75"
        >
          Clear selected media
        </button>
      </footer>
    </div>
  );
}