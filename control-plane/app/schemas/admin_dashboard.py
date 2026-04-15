from pydantic import BaseModel


class UserCounts(BaseModel):
    total: int
    pending: int
    active: int
    suspended: int


class NodeCounts(BaseModel):
    online: int
    offline: int
    draining: int


class JobCounts(BaseModel):
    queued: int
    running: int
    completed_24h: int
    failed_24h: int
    cancelled_24h: int


class ComputeCounts(BaseModel):
    gpu_hours_served_24h: int


class AdminDashboardResponse(BaseModel):
    users: UserCounts
    nodes: NodeCounts
    jobs: JobCounts
    compute: ComputeCounts
