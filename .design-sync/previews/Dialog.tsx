import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "reelready";
import { Button } from "reelready";

export const Open = () => (
  <Dialog defaultOpen>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete this listing?</DialogTitle>
        <DialogDescription>
          &ldquo;123 Main St&rdquo; and its video will be permanently removed. This can&rsquo;t be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost">Cancel</Button>
        <Button variant="destructive">Delete listing</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
