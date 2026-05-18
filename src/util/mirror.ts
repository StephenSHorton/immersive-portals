const Y_SPIN = CFrame.fromEulerAnglesXYZ(0, math.pi, 0);

/**
 * Intersect a ray (origin + direction) with an infinite plane (point + normal).
 * Returns the hit point and the parametric `t` along the ray (0 = origin,
 * 1 = origin + direction).
 */
export function rayPlane(
	origin: Vector3,
	direction: Vector3,
	planePoint: Vector3,
	planeNormal: Vector3,
): LuaTuple<[Vector3, number]> {
	const r = origin.sub(planePoint);
	const t = -r.Dot(planeNormal) / direction.Dot(planeNormal);
	return [origin.add(direction.mul(t)), t] as LuaTuple<[Vector3, number]>;
}

/**
 * Whether the segment from `from`→`to` crosses the front of a rectangular
 * portal surface, moving INTO the front face. Use for the camera-through-portal
 * check (focus→camera segment): we only want the OffsetCam mirror to kick in
 * when the camera is BEHIND the portal looking at the focus on the other side.
 *
 * Requires the segment to be moving INTO the portal's front face (dot < 0 with
 * LookVector), hit within the rect bounds, and hit between the endpoints
 * (0 ≤ t ≤ 1).
 */
export function segmentCrossesRect(
	from: Vector3,
	to: Vector3,
	planeCFrame: CFrame,
	planeSize: Vector3,
): boolean {
	const direction = to.sub(from);
	if (direction.Dot(planeCFrame.LookVector) >= 0) return false;
	return segmentCrossesRectBidirectional(from, to, planeCFrame, planeSize);
}

/**
 * Direction-agnostic variant of `segmentCrossesRect`. Use for the teleport
 * check (HRP segment): players should be able to walk into a portal from
 * EITHER face — getting stuck because the part happens to be oriented Back-
 * toward-the-spawn is a common authoring footgun.
 */
export function segmentCrossesRectBidirectional(
	from: Vector3,
	to: Vector3,
	planeCFrame: CFrame,
	planeSize: Vector3,
): boolean {
	const direction = to.sub(from);
	const denominator = direction.Dot(planeCFrame.LookVector);
	if (denominator === 0) return false;

	const [hit, t] = rayPlane(from, direction, planeCFrame.Position, planeCFrame.LookVector);
	if (t < 0 || t > 1) return false;

	const local_ = planeCFrame.PointToObjectSpace(hit);
	return math.abs(local_.X) <= planeSize.X / 2 && math.abs(local_.Y) <= planeSize.Y / 2;
}

/**
 * Mirror a CFrame from one portal plane to its partner, suitable for
 * positioning a render camera that "looks through" portal A onto the world
 * around portal B. Applies a yaw flip (Y_SPIN) so that a viewer facing INTO
 * portal A appears to be facing OUT of portal B's back — i.e., the camera on
 * the partner side looks back through the partner's front, which is what
 * makes the "magic window into the other room" effect work.
 *
 * Matches the original Lua: `planeB * Y_SPIN * planeA:ToObjectSpace(cf)`.
 */
export function mirrorCFrameForCamera(cf: CFrame, planeA: CFrame, planeB: CFrame): CFrame {
	const local_ = planeA.ToObjectSpace(cf);
	return planeB.mul(Y_SPIN).mul(local_);
}

/**
 * Mirror a CFrame for teleporting a body through a portal. Differs from the
 * camera mirror: position's local X is negated (so the body emerges on the
 * mirrored side of the rect), and the Y_SPIN is applied AFTER the local
 * transform so the body faces outward through the partner.
 */
export function mirrorCFrameForTeleport(cf: CFrame, planeA: CFrame, planeB: CFrame): CFrame {
	const local_ = planeA.ToObjectSpace(cf);
	const [px, py, pz, r00, r01, r02, r10, r11, r12, r20, r21, r22] = local_.GetComponents();
	const flipped = new CFrame(-px, py, pz, r00, r01, r02, r10, r11, r12, r20, r21, r22);
	return planeB.mul(flipped).mul(Y_SPIN);
}

export { Y_SPIN };
