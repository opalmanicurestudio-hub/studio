if (isMobile) {
    return (
      <>
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" className="h-[92dvh] rounded-t-[3rem] p-0 border-none bg-background flex flex-col overflow-hidden shadow-2xl">
            <div className="flex-shrink-0 text-left border-b bg-muted/5 p-6">
              <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span>
              </div>
              <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">{dialogTitle}</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{dialogDescription}</p>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-6">{FormContent}</div>
            </ScrollArea>
            <div className="flex-shrink-0 border-t bg-background shadow-2xl p-4">
              <div className="grid grid-cols-2 gap-3 w-full">
                <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
                <Button onClick={handleSave} className="h-12 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Establish Bundle <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
        <BrowseProductsDialog open={isApplicableProductsSelectorOpen} onOpenChange={setIsApplicableProductsSelectorOpen} onSelect={(selected) => setApplicableProductIds(selected.map(p => p.id))} allProducts={inventory.filter(p => p.type === 'retail' || p.type === 'refreshment')} initialSelected={inventory.filter(p => applicableProductIds.includes(p.id))} />
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl h-[90dvh] !flex flex-col !gap-0 p-0 border-4 rounded-[2.5rem] overflow-hidden shadow-2xl">
          <div className="flex-shrink-0 text-left border-b bg-muted/5 p-8 pb-6">
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">{dialogTitle}</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{dialogDescription}</p>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-8">{FormContent}</div>
          </ScrollArea>
          <div className="flex-shrink-0 border-t bg-background shadow-2xl p-6 sm:p-10 pt-4">
            <div className="grid grid-cols-2 gap-3 w-full">
              <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="h-12 font-black uppercase tracking-tighter text-[10px] text-slate-400">Cancel</Button>
              <Button onClick={handleSave} className="h-12 rounded-[2rem] font-black uppercase tracking-widest text-[10px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Establish Bundle <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <BrowseProductsDialog open={isApplicableProductsSelectorOpen} onOpenChange={setIsApplicableProductsSelectorOpen} onSelect={(selected) => setApplicableProductIds(selected.map(p => p.id))} allProducts={inventory.filter(p => p.type === 'retail' || p.type === 'refreshment')} initialSelected={inventory.filter(p => applicableProductIds.includes(p.id))} />
    </>
  );
};